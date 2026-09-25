import type { ReopenRecoveryLifecycle } from "./reopen-recovery";
export class QuestReopenLifecycle {
  private active = true; private generation = 0;
  private readonly coordinator: ReopenRecoveryLifecycle;
  private readonly occurrenceId: string;
  private readonly executionCycle: number;
  constructor(coordinator: ReopenRecoveryLifecycle, occurrenceId: string, executionCycle: number) {
    this.coordinator = coordinator; this.occurrenceId = occurrenceId; this.executionCycle = executionCycle;
  }
  activate() { this.active = true; }
  deactivate() { this.active = false; this.generation++; }
  private validity() { const generation = this.generation; return () => this.active && generation === this.generation; }
  async submit() { await this.coordinator.submitForOccurrence(this.occurrenceId, this.executionCycle, this.validity()); }
  async retry() { await this.coordinator.retryForOccurrence(this.occurrenceId, this.executionCycle, this.validity()); }
}