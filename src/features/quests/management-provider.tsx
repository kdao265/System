"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { manageQuest } from "./management-action";
import { MANAGEMENT_LOCK, MANAGEMENT_PREFIX, QuestManagementLifecycle, getManagementServerSnapshot } from "./management-lifecycle";

const Context = createContext<QuestManagementLifecycle | null>(null);
export function useQuestManagement() {
  const controller = useContext(Context);
  if (!controller) throw new Error("Quest management requires a Dashboard owner");
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, getManagementServerSnapshot);
  return { controller, state };
}

export function QuestManagementProvider(props: { userId: string; locale: Locale; children: ReactNode }) {
  return <AccountManagementProvider key={props.userId} {...props} />;
}

function AccountManagementProvider({ userId, locale, children }: { userId: string; locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const t = getDictionary(locale).questManage;
  const [controller] = useState(() => new QuestManagementLifecycle(userId, {
    storage: () => window.localStorage,
    lock: async (work) => {
      if (!navigator.locks) throw new Error("Cross-tab coordination unavailable");
      return navigator.locks.request(MANAGEMENT_LOCK, work);
    },
    uuid: () => crypto.randomUUID(),
    send: manageQuest,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, getManagementServerSnapshot);
  useEffect(() => {
    controller.activate();
    void controller.recover();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === MANAGEMENT_PREFIX + userId) void controller.recover();
    };
    const onFocus = () => { void controller.recover(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    let unsubscribe = () => {};
    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session?.user.id !== userId) { controller.deactivate(); router.refresh(); }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { controller.deactivate(); }
    return () => {
      controller.deactivate();
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [controller, router, userId]);
  useEffect(() => {
    if (state.result?.outcome === "success") router.refresh();
  }, [router, state.result]);

  return <Context.Provider value={controller}>
    {(state.pending || state.phase === "blocked") && <section aria-label={t.recoveryTitle} className="mb-4 rounded-md border border-amber-700 p-4 text-sm text-amber-100">
      <h2>{t.recoveryTitle}</h2>
      {state.pending && <p className="mt-2">{t[state.pending.operation]}: {state.pending.title}</p>}
      <p role="alert" className="mt-2">{state.phase === "blocked" ? t.recoveryBlocked : t.unknown}</p>
      {state.pending && <button type="button" disabled={state.phase !== "uncertain"}
        onClick={() => { void controller.retry(); }} className="mt-3 rounded-md border px-3 py-2 disabled:opacity-50">{t.retryExact}</button>}
      {state.phase === "blocked" && <button type="button" onClick={() => { void controller.recover(); }} className="mt-3 underline">{t.checkRecovery}</button>}
    </section>}
    {children}
  </Context.Provider>;
}
