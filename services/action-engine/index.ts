// Action Engine - the ONLY component allowed to execute runtime interventions

import { v4 as uuid } from 'uuid';
import type { CandidateAction, InterventionRecord } from './types.js';
import { PolicyStore } from './policy-store.js';
import { ActionValidator } from './validator.js';
import { InterventionStore } from './intervention-store.js';
import { InterventionExecutor, type ActionDeps } from './executor.js';

// Re-export types for consumers
export type { ActionStatus, InterventionRecord, ActionResult, CandidateAction, InterventionRequest, InterventionResponse, ActionLimits } from './types.js';

// Re-export for testing
export { PolicyStore } from './policy-store.js';
export { ActionValidator } from './validator.js';
export type { PolicyDecision } from './validator.js';
export { InterventionStore } from './intervention-store.js';
export { InterventionExecutor } from './executor.js';
export type { ActionDeps } from './executor.js';

/**
 * Creates an ActionEngineStub that the RunOrchestrator expects.
 *
 * The stub:
 * 1. Validates the candidate action against policy using ActionValidator
 * 2. If denied → records with policyDecision: 'denied' and returns
 * 3. If allowed → executes the action via InterventionExecutor
 * 4. Records the full InterventionRecord with execution result
 */
export function createActionEngine(deps: ActionDeps): {
  requestIntervention: (opts: {
    runId: string;
    stepId?: string;
    candidate: CandidateAction;
    diagnosisId?: string;
  }) => Promise<InterventionRecord>;
  interventions: InterventionStore;
} {
  const policy = new PolicyStore();
  const interventions = new InterventionStore();
  const validator = new ActionValidator(policy, interventions);
  const executor = new InterventionExecutor(deps);

  async function requestIntervention(opts: {
    runId: string;
    stepId?: string;
    candidate: CandidateAction;
    diagnosisId?: string;
  }): Promise<InterventionRecord> {
    const { runId, stepId, candidate } = opts;

    // Create the base record
    const record: InterventionRecord = {
      id: uuid(),
      runId,
      stepId,
      triggerReason: candidate.reason,
      actionType: candidate.action,
      actionParameters: candidate.parameters ?? {},
      policyDecision: 'denied', // default
      timestamp: new Date().toISOString(),
    };

    // Note: We need the PipelineRun to validate limits
    // For now, we use a minimal run object for policy validation
    // The orchestrator passes the actual run context through the callback
    const decision = validator.validateAction(candidate, { id: runId, specId: '', status: 'running', riskLevel: 'low', attemptCounts: {} });

    record.policyDecision = decision;

    // If denied or guarded (guarded requires approval, out of scope for MVP), don't execute
    if (decision !== 'allowed') {
      interventions.save(record);
      return record;
    }

    // Execute the action
    record.executedAt = new Date().toISOString();
    const result = await executor.executeAction(candidate, { id: runId, specId: '', status: 'running', riskLevel: 'low', attemptCounts: {} }, record);
    record.executionResult = result;

    // Save and return
    interventions.save(record);
    return record;
  }

  return { requestIntervention, interventions };
}
