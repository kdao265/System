import { redirect, unstable_rethrow } from "next/navigation";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSessionFailure, mapProgressionOutcome, type ExpProgress, type ProgressionOutcome } from "./numbers";

/**
 * Feature-level data access for progression reads.
 * Runs on the server only; the browser never sees privileged keys and the
 * identity is derived server-side from the authenticated session.
 */

export type ProgressionResult =
  | { status: "ok"; exp: ExpProgress }
  | { status: "unavailable" };

// Error messages/hints may contain echoed inputs. Only known static messages
// and repository-owned SQL identifiers are safe to include in diagnostics.
function safeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const staticMessages = [
    "Authentication required", "JWT expired", "Invalid JWT", "Invalid JWT signature",
    "Auth session missing!", "TypeError: fetch failed", "fetch failed",
    "Could not find the function public.get_progression_status without parameters in the schema cache",
    "No function matches the given name and argument types. You might need to add explicit type casts.",
  ];
  if (staticMessages.includes(value)) return value;
  const object = "(?:(?:public|system_internal|progression_internal|exp_internal)\\.)?(?:public|system_internal|progression_internal|exp_internal|request_user_id|get_progression_status|exp_ledger|progression_policy_assignments|level_policies|level_thresholds|level_milestones|operator_grants|has_capability)";
  if (new RegExp(`^permission denied for (?:schema|table|function|relation) ${object}$`).test(value)) return value;
  if (new RegExp(`^function ${object}\\(\\) does not exist$`).test(value)) return value;
  return "[redacted: unrecognized diagnostic text]";
}

async function confirmInvalidSession(): Promise<boolean> {
  let sessionError: unknown;
  try {
    // Bypass render-cached requireUser(): the session may have changed since
    // the Profile gate. Auth, rather than an RPC permission error, decides.
    const supabase = await createServerSupabaseClient(true);
    const { data, error } = await supabase.auth.getUser();
    if (!error) return !data.user;
    sessionError = error;
  } catch (caught) {
    unstable_rethrow(caught);
    sessionError = caught;
  }
  return isAuthSessionMissingError(sessionError) || isSessionFailure(sessionError);
}

export async function getProgressionStatus(): Promise<ProgressionResult> {
  // Identity first, outside any catch: requireUser() redirects unauthenticated
  // visitors via Next.js and must never be swallowed into an error state.
  await requireUser();
  let outcome: ProgressionOutcome;
  try {
    const supabase = await createServerSupabaseClient(true);
    const { data, error, status } = await supabase.rpc("get_progression_status");
    if (process.env.NODE_ENV === "development" && error) {
      console.warn(JSON.stringify({
        rpc: "get_progression_status",
        code: /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(error.code) ? error.code : "[redacted]",
        message: safeDiagnosticText(error.message),
        ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
        ...(error.hint ? { hint: safeDiagnosticText(error.hint) } : {}),
      }));
    }
    outcome = isAuthSessionMissingError(error)
      ? { kind: "verify-session" }
      : mapProgressionOutcome(error, data);
  } catch (caught) {
    // Preserve framework control flow, including redirects from dependencies.
    unstable_rethrow(caught);
    outcome = isAuthSessionMissingError(caught)
      ? { kind: "verify-session" }
      : mapProgressionOutcome(caught ?? new Error("Progression read failed"), null);
  }
  // Keep our own redirect outside the transport catch, as in requireUser().
  if (outcome.kind === "verify-session" && await confirmInvalidSession()) redirect("/login");
  if (outcome.kind === "ok") return { status: "ok", exp: outcome.exp };
  return { status: "unavailable" };
}
