"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { useOnline } from "@/features/network/network-status";
import type { AuthState } from "./state";

export function useAuthAction(
  send: (previous: AuthState, data: FormData) => Promise<AuthState>,
  failure: string,
) {
  const submitting = useRef(false);
  const online = useOnline();
  // Keep the real Server Action on the form for pre-hydration/no-JS submission.
  // Only hydrated submits use a client transition to catch transport rejection.
  const [serverState, action, serverPending] = useActionState(send, {});
  const [clientState, setClientState] = useState<AuthState | null>(null);
  const [clientPending, startTransition] = useTransition();
  const state = clientState ?? serverState;
  const pending = serverPending || clientPending;
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || pending || !navigator.onLine) return;
    submitting.current = true;
    const data = new FormData(event.currentTarget);
    setClientState({});
    startTransition(async () => {
      try {
        setClientState(await send(state, data));
      } catch (error) {
        // Preserve framework redirects, including successful login/logout.
        unstable_rethrow(error);
        setClientState({ error: failure });
      } finally {
        submitting.current = false;
      }
    });
  }
  return { state, action, pending, onSubmit, disabled: pending || !online };
}
