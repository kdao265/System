import { dispatchCommand, prepareOperation, type AoAdapter, type CommandResult, type Operation, type Preparation } from "./application";

export type CommandState = { busy: boolean; locked: boolean; preparation: Preparation | null; result: CommandResult | null };

// One mounted editor owns one pending intent. No persistence, automatic retry,
// receipt resolution, optimistic writes or inferred current revision in L2-01.
export function createCommandSession(options: {
  adapter: AoAdapter; subjectId: string; revision: string | null;
  uuid: () => string; now: () => number;
}) {
  let state: CommandState = { busy: false, locked: false, preparation: null, result: null };
  const listeners = new Set<() => void>();
  const update = (next: CommandState) => { state = next; listeners.forEach(listener => listener()); };
  async function send(preparation: Preparation, confirmed: boolean) {
    update({ busy: true, locked: true, preparation, result: null });
    const result = await dispatchCommand(options.adapter, preparation, confirmed);
    update({ busy: false, locked: ["success", "unknown", "conflict"].includes(result.outcome), preparation, result });
    return result;
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit() {
      if (!state.locked) update({ ...state, preparation: null, result: null });
    },
    async submit(operation: Operation) {
      if (state.locked) return;
      const preparation = prepareOperation({ command_id: options.uuid(), subject_id: options.subjectId,
        expected_revision: options.revision }, operation, options.now());
      if (preparation.outcome !== "ready") {
        update({ busy: false, locked: preparation.outcome === "conflict", preparation, result: preparation }); return;
      }
      if (preparation.warnings.length) {
        update({ busy: false, locked: false, preparation, result: null }); return;
      }
      return send(preparation, false);
    },
    async confirm() {
      if (state.locked || state.preparation?.outcome !== "ready" || !state.preparation.warnings.length) return;
      return send(state.preparation, true);
    },
  };
}
