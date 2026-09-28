"use client";

import { useAuthAction } from "./use-auth-action";
import { logout } from "./actions";

export function LogoutForm() {
  const { state, action, pending, onSubmit, disabled } = useAuthAction(logout,
    "Sign-out could not be confirmed. Check your connection and try again.");
  return (
    <form action={action} onSubmit={onSubmit} className="mt-8" aria-busy={pending}>
      <button disabled={disabled} className="rounded-md border border-zinc-600 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50 pointer-coarse:py-3">
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {state.error && <p role="alert" className="mt-3 text-sm text-red-300">{state.error}</p>}
    </form>
  );
}
