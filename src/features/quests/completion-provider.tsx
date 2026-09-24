"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { completeQuest } from "./completion-action";
import { COMPLETION_PREFIX } from "./completion-pending";
import { COMPLETION_LOCK, CompletionRecoveryLifecycle } from "./completion-recovery";

const CompletionContext = createContext<CompletionRecoveryLifecycle | null>(null);

export function useCompletionCoordinator() {
  const coordinator = useContext(CompletionContext);
  if (!coordinator) throw new Error("Completion controls require the Dashboard owner.");
  return coordinator;
}

/** Server panels/Suspense remain children; refresh keeps this account-keyed owner. */
export function QuestCompletionProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <AccountCompletionProvider key={userId} userId={userId}>{children}</AccountCompletionProvider>;
}

function AccountCompletionProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [coordinator] = useState(() => new CompletionRecoveryLifecycle(userId, {
    storage: () => window.localStorage,
    lock: async (_account, work) => {
      if (!navigator.locks) throw new Error("Cross-tab coordination unavailable");
      return navigator.locks.request(COMPLETION_LOCK, work);
    },
    send: completeQuest,
    uuid: () => crypto.randomUUID(),
  }));
  useEffect(() => {
    coordinator.activate();
    void coordinator.recover();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(`${COMPLETION_PREFIX}${userId}:`)) void coordinator.recover();
    };
    const onFocus = () => { void coordinator.recover(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    let unsubscribe = () => {};
    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session?.user.id !== userId) { coordinator.deactivate(); window.location.reload(); }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { coordinator.deactivate(); }
    return () => {
      coordinator.deactivate();
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [coordinator, userId]);
  return <CompletionContext.Provider value={coordinator}>{children}</CompletionContext.Provider>;
}
