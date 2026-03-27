// In-memory store for InterventionRecord

import type { InterventionRecord } from './types.js';

export class InterventionStore {
  private readonly records: InterventionRecord[] = [];

  save(record: InterventionRecord): void {
    this.records.push(record);
  }

  getForRun(runId: string): InterventionRecord[] {
    return this.records.filter((r) => r.runId === runId);
  }

  getForStep(runId: string, stepId: string): InterventionRecord[] {
    return this.records.filter((r) => r.runId === runId && r.stepId === stepId);
  }

  countForRun(runId: string): number {
    return this.records.filter((r) => r.runId === runId).length;
  }

  countForStep(runId: string, stepId: string): number {
    return this.records.filter((r) => r.runId === runId && r.stepId === stepId).length;
  }

  /**
   * Clears all records (useful for testing)
   */
  clear(): void {
    this.records.length = 0;
  }
}
