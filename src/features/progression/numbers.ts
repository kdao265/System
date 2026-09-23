/**
 * Exact numeric handling for progression display values.
 *
 * Server `numeric` values arrive as JSON numbers via PostgREST. The JSON parse
 * already rounds beyond Number.MAX_SAFE_INTEGER before application code runs,
 * so any value that is not a safe integer (or an exact digit string) must fail
 * closed: never render a rounded or silently approximated EXP value.
 */

export type ExactInteger = { ok: true; value: bigint };
export type ExactIntegerFailure = { ok: false; reason: "missing" | "unsafe" | "malformed" };
export type ExactIntegerResult = ExactInteger | ExactIntegerFailure;

const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;

/**
 * Convert a transported JSON value into an exact BigInt.
 * Accepts safe integers (as numbers) and canonical decimal digit strings.
 * Rejects everything else, including non-safe numbers that would be rounded.
 */
export function toExactInteger(input: unknown): ExactIntegerResult {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, reason: "malformed" };
    if (!Number.isSafeInteger(input)) return { ok: false, reason: "unsafe" };
    return { ok: true, value: BigInt(input) };
  }
  if (typeof input === "string") {
    if (!DECIMAL_INTEGER.test(input)) return { ok: false, reason: "malformed" };
    return { ok: true, value: BigInt(input) };
  }
  if (input === null || input === undefined) return { ok: false, reason: "missing" };
  return { ok: false, reason: "malformed" };
}

/** Exact decimal text for display; never rounded or abbreviated. */
export function formatExactInteger(value: bigint): string {
  return value.toString(10);
}

/** PostgreSQL integer bounds for Level fields (independent of unbounded EXP). */
const PG_INT_MAX = BigInt(2147483647);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);

/**
 * Validate a PostgreSQL integer-typed field (e.g. Levels) independently of the
 * unbounded `numeric` EXP handling: positive and within int4 range.
 * Rejection happens before any Number conversion.
 */
export function toPgLevel(input: unknown): ExactIntegerResult {
  const exact = toExactInteger(input);
  if (!exact.ok) return exact;
  if (exact.value < ONE || exact.value > PG_INT_MAX) {
    return { ok: false, reason: "unsafe" };
  }
  return exact;
}

export type ExpProgress =
  | {
      state: "available";
      currentLevel: number;
      highestLevel: number | null;
      currentExpText: string;
      nextLevel: number | null;
      expToNextText: string | null;
      /** Integer 0..100 percent within the current Level span; null at max level. */
      percentInLevel: number | null;
    }
  | { state: "unavailable" }
  | { state: "invalid" };

const INVALID: ExpProgress = { state: "invalid" };

// Every field of the frozen composite must be present; only explicit SQL NULL
// is optional-valued. Omitted fields mean the response shape is malformed.
const COMPOSITE_FIELDS = [
  "available",
  "current_exp",
  "current_level",
  "highest_level",
  "policy_id",
  "policy_key",
  "policy_version",
  "current_level_required_exp",
  "next_level",
  "next_level_required_exp",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildAvailable(
  exp: bigint,
  currentLevel: bigint,
  highestLevel: bigint | null,
  nextLevel: bigint | null,
  nextThreshold: bigint | null,
  currentThreshold: bigint,
): ExpProgress {
  return {
    state: "available",
    currentLevel: Number(currentLevel),
    highestLevel: highestLevel === null ? null : Number(highestLevel),
    currentExpText: formatExactInteger(exp),
    nextLevel: nextLevel === null ? null : Number(nextLevel),
    expToNextText: nextThreshold === null ? null : formatExactInteger(nextThreshold - exp),
    percentInLevel:
      nextThreshold === null
        ? null
        : Number(((exp - currentThreshold) * HUNDRED) / (nextThreshold - currentThreshold)),
  };
}

/**
 * Map the frozen `public.progression_status` composite into display values.
 * Strict shape validation: a non-object, missing field, wrong type or a
 * violated threshold relationship is invalid data — never "not configured"
 * and never max level. No clamping and no Level derivation happen here.
 */
export function mapExpProgress(input: unknown): ExpProgress {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return INVALID;
  const row = input as Record<string, unknown>;
  if (typeof row.available !== "boolean") return INVALID;
  if (Object.keys(row).length !== COMPOSITE_FIELDS.length) return INVALID;
  if (COMPOSITE_FIELDS.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) return INVALID;

  // SQL always returns the ledger sum, even without an assigned policy.
  // Historical highest_level may also survive when progression is unavailable.
  const exp = toExactInteger(row.current_exp);
  const highestLevel = row.highest_level === null ? null : toPgLevel(row.highest_level);
  if (!exp.ok || exp.value < ZERO || (highestLevel !== null && !highestLevel.ok)) return INVALID;
  if (!row.available) {
    return ["current_level", "policy_id", "policy_key", "policy_version",
      "current_level_required_exp", "next_level", "next_level_required_exp"]
      .every((key) => row[key] === null) ? { state: "unavailable" } : INVALID;
  }

  if (typeof row.policy_id !== "string" || !UUID.test(row.policy_id)) return INVALID;
  if (typeof row.policy_key !== "string" || row.policy_key.trim().length === 0) return INVALID;
  if (!toPgLevel(row.policy_version).ok) return INVALID;
  const currentLevel = toPgLevel(row.current_level);
  const currentThreshold = toExactInteger(row.current_level_required_exp);
  if (!currentLevel.ok || !currentThreshold.ok) return INVALID;

  // EXP is a signed ledger sum; a displayable status is never negative.
  if (currentThreshold.value < ZERO) return INVALID;
  if (highestLevel !== null && highestLevel.value < currentLevel.value) return INVALID;

  // The paired next fields are both set or both explicitly NULL at the cap.
  const nextRaw = row.next_level;
  const nextThresholdRaw = row.next_level_required_exp;
  const nextIsNull = nextRaw === null && nextThresholdRaw === null;
  if (!nextIsNull && (nextRaw === null || nextThresholdRaw === null)) return INVALID;

  if (nextIsNull) {
    // Max published Level: no next threshold exists and none may be invented.
    if (exp.value < currentThreshold.value) return INVALID;
    return buildAvailable(
      exp.value,
      currentLevel.value,
      highestLevel === null ? null : highestLevel.value,
      null,
      null,
      currentThreshold.value,
    );
  }

  const nextLevel = toPgLevel(nextRaw);
  const nextThreshold = toExactInteger(nextThresholdRaw);
  if (!nextLevel.ok || !nextThreshold.ok) return INVALID;
  if (nextThreshold.value < ZERO) return INVALID;

  const span = nextThreshold.value - currentThreshold.value;
  if (span <= ZERO) return INVALID;
  if (nextLevel.value !== currentLevel.value + ONE) return INVALID;

  // EXP must lie inside the current Level's interval [T(current), T(next)).
  // Data outside it is inconsistent: rejected, never clamped or re-derived.
  if (exp.value < currentThreshold.value || exp.value >= nextThreshold.value) return INVALID;

  return buildAvailable(
    exp.value,
    currentLevel.value,
    highestLevel === null ? null : highestLevel.value,
    nextLevel.value,
    nextThreshold.value,
    currentThreshold.value,
  );
}

export type ProgressionOutcome =
  | { kind: "ok"; exp: ExpProgress }
  | { kind: "verify-session" }
  | { kind: "unavailable" };

/**
 * Pure classification of one RPC invocation outcome so the auth-recovery and
 * unavailable paths stay testable independently of the Supabase client.
 */
export function mapProgressionOutcome(rpcError: unknown, data: unknown): ProgressionOutcome {
  if (rpcError !== null && rpcError !== undefined) {
    // SQL permission and PostgREST token failures concern this RPC. They do
    // not establish whether Supabase Auth still accepts the login session.
    if (isSessionFailure(rpcError) || (
      typeof rpcError === "object" && "code" in rpcError &&
      typeof rpcError.code === "string" &&
      ["42501", "PGRST301", "PGRST302", "PGRST303"].includes(rpcError.code)
    )) return { kind: "verify-session" };
    return { kind: "unavailable" };
  }
  return { kind: "ok", exp: mapExpProgress(data) };
}

/**
 * Explicit session failures from Supabase Auth verification. SQLSTATE 42501
 * also means insufficient privilege and is deliberately not session evidence.
 * Network/configuration failures likewise do not establish an invalid login.
 */
export function isSessionFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    ["bad_jwt", "invalid_jwt",
      "session_not_found", "session_expired", "refresh_token_not_found",
      "refresh_token_already_used"].includes(error.code)
  );
}
