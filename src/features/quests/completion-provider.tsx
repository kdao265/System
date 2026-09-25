"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { completeQuest } from "./completion-action";
import { COMPLETION_PREFIX } from "./completion-pending";
import { COMPLETION_LOCK, CompletionRecoveryLifecycle } from "./completion-recovery";
import { reopenQuest } from "./reopen-action";
import { REOPEN_PREFIX } from "./reopen-pending";
import { ReopenRecoveryLifecycle } from "./reopen-recovery";
import type { DayQuestResult } from "./model";

const CompletionContext = createContext<CompletionRecoveryLifecycle | null>(null);
const ReopenContext = createContext<ReopenRecoveryLifecycle | null>(null);

export function useCompletionCoordinator() {
  const coordinator = useContext(CompletionContext);
  if (!coordinator) throw new Error("Completion controls require the Dashboard owner.");
  return coordinator;
}

export function useReopenCoordinator() {
  const coordinator = useContext(ReopenContext);
  if (!coordinator) throw new Error("Reopen controls require the Dashboard owner.");
  return coordinator;
}

/** Only the server Quest panel supplies this read; refresh callbacks never do. */
export function QuestReopenRead({ userId, result }: { userId: string; result: DayQuestResult }) {
  const coordinator = useReopenCoordinator();
  useEffect(() => { void coordinator.observeServerRead(userId, result); }, [coordinator, userId, result]);
  return null;
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
  const [reopenCoordinator] = useState(() => new ReopenRecoveryLifecycle(userId, {
    storage: () => window.localStorage,
    lock: async (_account, work) => {
      if (!navigator.locks) throw new Error("Cross-tab coordination unavailable");
      return navigator.locks.request(COMPLETION_LOCK, work);
    },
    send: reopenQuest,
    uuid: () => crypto.randomUUID(),
  }));
  useEffect(() => {
    coordinator.activate();
    reopenCoordinator.activate();
    void coordinator.recover();
    void reopenCoordinator.recover();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(`${COMPLETION_PREFIX}${userId}:`)) void coordinator.recover();
      if (event.key === null || event.key.startsWith(`${REOPEN_PREFIX}${userId}:`)) void reopenCoordinator.recover();
    };
    const onFocus = () => { void coordinator.recover(); void reopenCoordinator.recover(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    let unsubscribe = () => {};
    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session?.user.id !== userId) { coordinator.deactivate(); reopenCoordinator.deactivate(); window.location.reload(); }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { coordinator.deactivate(); reopenCoordinator.deactivate(); }
    return () => {
      coordinator.deactivate();
      reopenCoordinator.deactivate();
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [coordinator, reopenCoordinator, userId]);
  return <CompletionContext.Provider value={coordinator}><ReopenContext.Provider value={reopenCoordinator}>{children}</ReopenContext.Provider></CompletionContext.Provider>;
}
