import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("./") && context.parentURL?.includes("/src/features/library/")) {
    return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { prepareCreateIdentity, readCreateIdentity, clearCreateIdentity } = await import("../src/features/library/create-identity.ts");
hooks.deregister();
const userId = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const bookId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identity = { version: 1, userId, bookId };
function storage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test("create preparation persists exactly identity metadata before ready, with one UUID across retry/reload", () => {
  const store = storage(); let generations = 0;
  const first = prepareCreateIdentity(store, userId, () => { generations++; return bookId; });
  assert.deepEqual(first, { outcome: "ready", identity });
  assert.deepEqual(JSON.parse([...store.entries.values()][0]), identity);
  for (let n = 0; n < 3; n++) assert.deepEqual(prepareCreateIdentity(store, userId, () => { generations++; return other; }), first);
  assert.deepEqual(readCreateIdentity(store, userId), first);
  assert.equal(generations, 1); assert.equal(store.entries.size, 1);
});

test("storage reads/writes and UUID generation failures cannot yield permission to dispatch", () => {
  for (const broken of [null, { getItem() { throw new Error("Unavailable"); } },
    { getItem: () => null, setItem() { throw new Error("Quota"); } }, { getItem: () => null, setItem() {} }]) {
    assert.equal(prepareCreateIdentity(broken, userId, () => bookId).outcome, "storage_unavailable");
  }
  assert.equal(prepareCreateIdentity(storage(), userId, () => { throw new Error("No random source"); }).outcome, "storage_unavailable");
  assert.equal(prepareCreateIdentity(storage(), userId, () => "bad").outcome, "invalid_identity");
  assert.equal(prepareCreateIdentity(storage(), "bad", () => bookId).outcome, "invalid_identity");
});

test("reload is read-only, rejects malformed/extra-field metadata and never scans another namespace", () => {
  for (const raw of ["{", "null", "[]", JSON.stringify({ ...identity, version: 2 }),
    JSON.stringify({ ...identity, bookId: "bad" }), JSON.stringify({ ...identity, title: "Private synthetic title" }),
    JSON.stringify({ ...identity, content_notes: "Synthetic note" })]) {
    const store = storage(); prepareCreateIdentity(store, userId, () => bookId);
    const key = [...store.entries.keys()][0]; store.entries.set(key, raw);
    assert.equal(readCreateIdentity(store, userId).outcome, "invalid_identity");
    assert.equal(prepareCreateIdentity(store, userId, () => { throw new Error("Must not replace"); }).outcome, "invalid_identity");
    assert.equal(store.entries.get(key), raw);
  }
  const store = storage(); store.entries.set("unrelated", "preserved");
  assert.equal(readCreateIdentity(store, userId).outcome, "empty");
  assert.equal(store.entries.size, 1);
});

test("account changes block old intent and do not replace a pending identity", () => {
  const store = storage(); prepareCreateIdentity(store, userId, () => bookId);
  assert.equal(readCreateIdentity(store, other).outcome, "account_changed");
  assert.equal(prepareCreateIdentity(store, other, () => { throw new Error("Must not generate"); }).outcome, "account_changed");
  assert.deepEqual(readCreateIdentity(store, userId), { outcome: "ready", identity });
});

test("explicit resolution clears only the same attempt, preserves unrelated entries and allows a new identity", () => {
  const store = storage(); store.entries.set("unrelated", "preserved");
  prepareCreateIdentity(store, userId, () => bookId);
  assert.equal(clearCreateIdentity(store, { ...identity, bookId: other }).outcome, "invalid_identity");
  assert.equal(readCreateIdentity(store, userId).outcome, "ready");
  assert.equal(clearCreateIdentity(store, identity).outcome, "cleared");
  assert.equal(readCreateIdentity(store, userId).outcome, "empty");
  assert.equal(store.entries.get("unrelated"), "preserved");
  assert.equal(prepareCreateIdentity(store, userId, () => other).identity.bookId, other);
});

test("failed cleanup retains recoverable identity; malformed cleanup requests do not remove anything", () => {
  for (const removeItem of [() => { throw new Error("Unavailable"); }, () => {}]) {
    const store = storage(); prepareCreateIdentity(store, userId, () => bookId); store.removeItem = removeItem;
    assert.equal(clearCreateIdentity(store, identity).outcome, "storage_unavailable");
    assert.equal(readCreateIdentity(store, userId).outcome, "ready");
  }
  const store = storage(); prepareCreateIdentity(store, userId, () => bookId);
  for (const value of [null, {}, { ...identity, notes: "Unexpected" }]) assert.equal(clearCreateIdentity(store, value).outcome, "invalid_identity");
  assert.equal(readCreateIdentity(store, userId).outcome, "ready");
});
