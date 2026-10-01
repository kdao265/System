"use client";

import { Button } from "@/components/ui/primitives";
import { useAuthAction } from "./use-auth-action";
import { logout } from "./actions";

export function LogoutForm() {
  const { state, action, pending, onSubmit, disabled } = useAuthAction(logout,
    "Sign-out could not be confirmed. Check your connection and try again.");
  return (
    <form action={action} onSubmit={onSubmit} className="mt-8" aria-busy={pending}>
      <Button type="submit" disabled={disabled}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {state.error && <p role="alert" className="mt-3 text-sm text-red-300">{state.error}</p>}
    </form>
  );
}
