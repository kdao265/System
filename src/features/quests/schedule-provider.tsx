"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/features/network/network-status";
import { createSupabaseClient } from "@/lib/supabase/client";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { UUID } from "./create-pending";
import { saveScheduleDefaults } from "./series-actions";
import {
  SCHEDULE_LOCK,
  SCHEDULE_PREFIX,
  ScheduleDefaultsLifecycle,
  type ScheduleDependencies,
  type ScheduleView,
} from "./schedule-pending";

type RecoveryEntry = {
  questId: string;
  controller: ScheduleDefaultsLifecycle;
  view: ScheduleView;
};

const REGISTRY_SERVER_SNAPSHOT = 0;
const getRegistryServerSnapshot = () => REGISTRY_SERVER_SNAPSHOT;

/**
 * One schedule-defaults lifecycle per Quest ID for the active account.
 *
 * Ownership lives at Dashboard/account scope so an unresolved durable command
 * survives modal close, row disappearance and later reopening.
 */
export class ScheduleDefaultsRegistry {
  private readonly controllers = new Map<string, ScheduleDefaultsLifecycle>();
  private readonly controllerUnsubscribers = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private active = true;
  private version = 0;

  constructor(
    private readonly userId: string,
    private readonly makeDependencies?: () => ScheduleDependencies,
  ) {}

  getSnapshot = () => this.version;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit = () => {
    this.version += 1;
    for (const listener of this.listeners) listener();
  };

  private dependencies(): ScheduleDependencies {
    if (this.makeDependencies) return this.makeDependencies();

    return {
      storage: () => window.localStorage,
      lock: async <T,>(work: () => Promise<T>) => {
        if (!navigator.locks) throw new Error("Tab coordination unavailable");
        return navigator.locks.request(SCHEDULE_LOCK, work);
      },
      uuid: () => crypto.randomUUID(),
      send: (operation) => saveScheduleDefaults({
        userId: operation.userId,
        commandId: operation.commandId,
        questId: operation.questId,
        expectedRevision: operation.expectedRevision,
        defaults: operation.defaults,
      }),
    };
  }

  get(questId: string) {
    let controller = this.controllers.get(questId);

    if (!controller) {
      controller = new ScheduleDefaultsLifecycle(
        this.userId,
        questId,
        this.dependencies(),
      );

      if (!this.active) controller.deactivate();

      this.controllers.set(questId, controller);

      const unsubscribe = controller.subscribe(this.emit);
      this.controllerUnsubscribers.set(questId, unsubscribe);
    }

    return controller;
  }

  activate() {
    this.active = true;

    for (const controller of this.controllers.values()) {
      controller.activate();
    }
  }

  deactivate() {
    this.active = false;

    for (const controller of this.controllers.values()) {
      controller.deactivate();
    }
  }

  accountChanged(userId: string | undefined) {
    if (userId === this.userId) return false;

    this.deactivate();
    return true;
  }

  /**
   * Discover durable commands even when their row/modal has not created a
   * controller during this render.
   */
  private discoverStoredQuestIds() {
    const questIds: string[] = [];

    try {
      const storage = this.dependencies().storage();
      const head = `${SCHEDULE_PREFIX}${this.userId}:`;

      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(head)) continue;

        const questId = key.slice(head.length);
        if (UUID.test(questId)) questIds.push(questId);
      }
    } catch {
      // Existing controllers surface storage failures through recover().
      // Discovery itself must never invent or delete recovery state.
    }

    return questIds;
  }

  recoveryEntries(): RecoveryEntry[] {
    return [...this.controllers.entries()]
      .map(([questId, controller]) => ({
        questId,
        controller,
        view: controller.getSnapshot(),
      }))
      .filter(({ view }) =>
        view.operation !== undefined ||
        view.phase === "blocked"
      )
      .sort((a, b) => a.questId.localeCompare(b.questId));
  }

  async recover(questId?: string) {
    if (!this.active) return;
    if (questId !== undefined) {
      if (!UUID.test(questId)) return;
      await this.get(questId).recover();
      return;
    }

    for (const storedQuestId of this.discoverStoredQuestIds()) {
      this.get(storedQuestId);
    }

    await Promise.all(
      [...this.controllers.values()].map((controller) => controller.recover()),
    );
  }
}

const Context = createContext<ScheduleDefaultsRegistry | null>(null);

export function useScheduleController(questId: string) {
  const registry = useContext(Context);

  if (!registry) {
    throw new Error("Recurring schedule defaults require a Dashboard owner");
  }

  return registry.get(questId);
}

export function ScheduleDefaultsProvider({
  userId,
  locale,
  children,
}: {
  userId: string;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <AccountScheduleProvider key={userId} userId={userId} locale={locale}>
      {children}
    </AccountScheduleProvider>
  );
}

function AccountScheduleProvider({
  userId,
  locale,
  children,
}: {
  userId: string;
  locale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const online = useOnline();
  const copy = getDictionary(locale).scheduleDefaults.recovery;
  const [registry] = useState(() => new ScheduleDefaultsRegistry(userId));

  useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    getRegistryServerSnapshot,
  );

  const recoveryEntries = registry.recoveryEntries();

  useEffect(() => {
    registry.activate();
    void registry.recover();

    const head = `${SCHEDULE_PREFIX}${userId}:`;

    const onStorage = (event: StorageEvent) => {
      if (event.key === null) {
        void registry.recover();
        return;
      }

      if (event.key.startsWith(head)) {
        void registry.recover(event.key.slice(head.length));
      }
    };

    const onFocus = () => {
      void registry.recover();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    let unsubscribe = () => {};

    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange(
        (_event, session) => {
          if (registry.accountChanged(session?.user.id)) {
            router.refresh();
          }
        },
      );

      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      registry.deactivate();
    }

    return () => {
      registry.deactivate();
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [registry, router, userId]);

  return (
    <Context.Provider value={registry}>
      {recoveryEntries.length > 0 && (
        <section
          aria-label={copy.title}
          className="mb-4 rounded-md border border-amber-700 bg-amber-950/20 p-4 text-sm text-amber-100"
        >
          <h2 className="font-semibold">{copy.title}</h2>

          <p className="mt-1">{copy.pending}</p>

          <div className="mt-3 space-y-3">
            {recoveryEntries.map(({ questId, controller, view }) => {
              const operation = view.operation;
              const defaults = operation?.defaults;

              const requestSummary =
                defaults?.local_start_time === null
                  ? copy.clear
                  : defaults
                    ? `${defaults.local_start_time}–${defaults.local_end_time}${
                        defaults.planned_end_day_offset === 1
                          ? ` (${copy.nextDay})`
                          : ""
                      }`
                    : null;

              return (
                <div
                  key={questId}
                  className="min-w-0 rounded-md border border-amber-800/70 p-3"
                >
                  <p className="break-all">
                    <span className="font-medium">{copy.quest}:</span>{" "}
                    {questId}
                  </p>

                  {requestSummary && (
                    <p className="mt-1 break-words">
                      <span className="font-medium">{copy.savedRequest}:</span>{" "}
                      {requestSummary}
                    </p>
                  )}

                  {view.phase === "sending" && (
                    <p role="status" className="mt-2">
                      {copy.sending}
                    </p>
                  )}

                  {view.phase === "blocked" && (
                    <p role="alert" className="mt-2">
                      {copy.blocked}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {operation && view.phase === "uncertain" && (
                      <button
                        type="button"
                        disabled={!online}
                        onClick={() => {
                          void controller.retry().then((settled) => {
                            if (settled) router.refresh();
                          });
                        }}
                        className="min-h-11 rounded-md border border-amber-600 px-3 py-2 disabled:opacity-50"
                      >
                        {copy.retry}
                      </button>
                    )}

                    {view.phase === "blocked" && (
                      <button
                        type="button"
                        onClick={() => {
                          void controller.recover();
                        }}
                        className="min-h-11 rounded-md border border-amber-600 px-3 py-2"
                      >
                        {copy.check}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {children}
    </Context.Provider>
  );
}