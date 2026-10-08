import { isBookId } from "./model";
import { keysAre, object } from "./contracts";

// L3 supplies sessionStorage inside a guarded browser event, never localStorage.
// Only these three identity fields may cross reloads. No draft is persisted.
export type CreateIdentity = { version: 1; userId: string; bookId: string };
type IdentityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type IdentityFailure = { outcome: "storage_unavailable" | "invalid_identity" | "account_changed" };
export type IdentityResult = { outcome: "ready"; identity: CreateIdentity } | { outcome: "empty" } | IdentityFailure;
const key = "system.library.pending-create.v1";

export function readCreateIdentity(storage: IdentityStorage, verifiedUserId: string): IdentityResult {
  if (!isBookId(verifiedUserId)) return { outcome: "invalid_identity" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { outcome: "empty" };
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return { outcome: "invalid_identity" }; }
    if (!object(value) || !keysAre(value, ["version", "userId", "bookId"]) || value.version !== 1 ||
        !isBookId(value.userId) || !isBookId(value.bookId)) return { outcome: "invalid_identity" };
    if (value.userId.toLowerCase() !== verifiedUserId.toLowerCase()) return { outcome: "account_changed" };
    return { outcome: "ready", identity: { version: 1, userId: value.userId.toLowerCase(), bookId: value.bookId.toLowerCase() } };
  } catch { return { outcome: "storage_unavailable" }; }
}

// Call before first dispatch. Existing attempts are returned unchanged, including
// after absence on reload. Only explicit resolution permits a replacement ID.
export function prepareCreateIdentity(storage: IdentityStorage, verifiedUserId: string,
  generateId: () => string = () => crypto.randomUUID()): IdentityResult {
  const pending = readCreateIdentity(storage, verifiedUserId);
  if (pending.outcome !== "empty") return pending;
  try {
    const bookId = generateId();
    if (!isBookId(bookId)) return { outcome: "invalid_identity" };
    const identity: CreateIdentity = { version: 1, userId: verifiedUserId.toLowerCase(), bookId: bookId.toLowerCase() };
    storage.setItem(key, JSON.stringify(identity));
    const stored = readCreateIdentity(storage, verifiedUserId);
    return stored.outcome === "ready" && stored.identity.bookId === identity.bookId
      ? stored : { outcome: "storage_unavailable" };
  } catch { return { outcome: "storage_unavailable" }; }
}

// Explicit recovery for blocked metadata only. The caller supplies the current
// verified account; a ready identity still requires the normal resolution flow.
export function clearBlockedCreateIdentity(storage: IdentityStorage, verifiedUserId: string):
  { outcome: "cleared" | "resolution_required" } | IdentityFailure {
  // readCreateIdentity also reports invalid_identity for an invalid account ID.
  // That is not evidence of blocked storage and must never authorize removal.
  if (!isBookId(verifiedUserId)) return { outcome: "invalid_identity" };
  const pending = readCreateIdentity(storage, verifiedUserId);
  if (pending.outcome === "empty") return { outcome: "cleared" };
  if (pending.outcome === "ready") return { outcome: "resolution_required" };
  if (pending.outcome !== "invalid_identity" && pending.outcome !== "account_changed") return pending;
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null ? { outcome: "cleared" } : { outcome: "storage_unavailable" };
  }
  catch { return { outcome: "storage_unavailable" }; }
}

// Invoke only after explicit resolution. Comparison protects a newer attempt
// from an older asynchronous completion; failed cleanup retains the same ID.
export function clearCreateIdentity(storage: IdentityStorage, identity: CreateIdentity): { outcome: "cleared" } | IdentityFailure {
  if (!object(identity) || !keysAre(identity, ["version", "userId", "bookId"]) || identity.version !== 1 ||
      !isBookId(identity.userId) || !isBookId(identity.bookId)) return { outcome: "invalid_identity" };
  const pending = readCreateIdentity(storage, identity.userId);
  if (pending.outcome === "empty") return { outcome: "cleared" };
  if (pending.outcome !== "ready") return pending;
  if (pending.identity.bookId !== identity.bookId.toLowerCase()) return { outcome: "invalid_identity" };
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null ? { outcome: "cleared" } : { outcome: "storage_unavailable" };
  }
  catch { return { outcome: "storage_unavailable" }; }
}
