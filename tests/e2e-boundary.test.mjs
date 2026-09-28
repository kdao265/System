import assert from "node:assert/strict";
import { test } from "node:test";
import { requireE2ERuntime, requireLoopbackOrigin } from "./helpers/e2e-boundary.mjs";

test("E2E rejects absent, remote, credential-bearing and non-origin targets", () => {
  for (const value of [undefined, "", "https://example.supabase.co", "http://localhost:54321",
    "http://127.0.0.1", "http://127.0.0.1:80", "https://127.0.0.1:12345",
    "http://secret@127.0.0.1:12345", "http://127.0.0.1:12345/path", "http://127.0.0.1:12345?key=secret"]) {
    assert.throws(() => requireLoopbackOrigin(value), /^Error: E2E requires a generated loopback origin/);
  }
  assert.equal(requireLoopbackOrigin("http://127.0.0.1:12345"), "http://127.0.0.1:12345");
});

test("E2E requires generated owner configuration and separate services", () => {
  const runtime = {
    app: "http://127.0.0.1:12345", url: "http://127.0.0.1:12346",
    owner: { id: "12345678-1234-4123-8123-123456789012", email: "auth-fixture@example.invalid", password: "0".repeat(48) + "Aa1!" },
  };
  runtime.owner.email = `auth-${runtime.owner.id}@example.invalid`;
  assert.deepEqual(requireE2ERuntime(runtime), [runtime.app, runtime.url]);
  for (const value of [undefined, {}, { ...runtime, owner: undefined },
    { ...runtime, owner: { ...runtime.owner, password: "" } },
    { ...runtime, owner: { ...runtime.owner, email: "real@example.com" } },
    { ...runtime, url: runtime.app }, { ...runtime, app: "https://production.example.com" }]) {
    assert.throws(() => requireE2ERuntime(value), /^Error: E2E/);
  }
});
