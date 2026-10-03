"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import { changeRecurrencePause } from "./recurrence-action";
import { PAUSE_LOCK, PAUSE_PREFIX, RecurrencePauseLifecycle, type Dependencies } from "./recurrence-pending";

/** Exactly one pause lifecycle per questId, shared by the definitions rows and the series modal. */
export class RecurrencePauseRegistry {
  private readonly controllers = new Map<string, RecurrencePauseLifecycle>();
  // Match the lifecycle's initially-active semantics, including child effects
  // that run before the provider effect. Later controllers inherit deactivation.
  private active = true;
  constructor(private readonly userId: string, private readonly makeDependencies?: () => Dependencies) {}
  get(questId: string) {
    let controller = this.controllers.get(questId);
    if (!controller) {
      controller = new RecurrencePauseLifecycle(this.userId, questId, this.makeDependencies ? this.makeDependencies() : {
        storage: () => window.localStorage,
        lock: async <T,>(work: () => Promise<T>) => {
          if (!navigator.locks) throw new Error("Tab coordination unavailable");
          return navigator.locks.request(PAUSE_LOCK, work);
        },
        uuid: () => crypto.randomUUID(),
        send: changeRecurrencePause,
      });
      if (!this.active) controller.deactivate();
      this.controllers.set(questId, controller);
    }
    return controller;
  }
  activate() {
    this.active = true;
    for (const controller of this.controllers.values()) controller.activate();
  }
  deactivate() {
    this.active = false;
    for (const controller of this.controllers.values()) controller.deactivate();
  }
  accountChanged(userId: string | undefined) {
    if (userId === this.userId) return false;
    this.deactivate();
    return true;
  }
  recover(questId?: string) {
    if (questId) return this.controllers.get(questId)?.recover();
    return Promise.all([...this.controllers.values()].map((controller) => controller.recover())).then(() => undefined);
  }
}

const Context = createContext<RecurrencePauseRegistry | null>(null);

/** The single pause controller for a quest; throws outside a Dashboard owner. */
export function usePauseController(questId: string) {
  const registry = useContext(Context);
  if (!registry) throw new Error("Recurrence pause requires a Dashboard owner");
  return registry.get(questId);
}

export function RecurrencePauseProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <AccountPauseProvider key={userId} userId={userId}>{children}</AccountPauseProvider>;
}

// Account-scoped listeners live here once, not per row or per modal, so recovery
// semantics (storage, focus, account change) stay identical to the former rows.
function AccountPauseProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const router = useRouter();
  const [registry] = useState(() => new RecurrencePauseRegistry(userId));
  useEffect(() => {
    registry.activate();
    void registry.recover();
    const head = `${PAUSE_PREFIX}${userId}:`;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) { void registry.recover(); return; }
      if (event.key.startsWith(head)) void registry.recover(event.key.slice(head.length));
    };
    const onFocus = () => { void registry.recover(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    let unsubscribe = () => {};
    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (registry.accountChanged(session?.user.id)) router.refresh();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { registry.deactivate(); }
    return () => {
      registry.deactivate();
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [registry, router, userId]);
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}
