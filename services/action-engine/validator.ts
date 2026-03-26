// Validates candidate actions against policy

import type { CandidateAction } from './types';
import type { ActionType, PipelineRun } from '../control-plane/types';
import { PolicyStore } from './policy-store';
import type { InterventionStore } from './intervention-store';

export type PolicyDecision = 'allowed' | 'denied' | 'guarded';

export class ActionValidator {
  constructor(
    private readonly policy: PolicyStore,
    private readonly interventions: InterventionStore,
  ) {}

  validateAction(candidate: CandidateAction, run: PipelineRun): PolicyDecision {
    const action = candidate.action;

    // If forbidden by policy → denied
    if (this.policy.isForbidden(action)) {
      return 'denied';
    }

    // If guarded → guarded (requires explicit approval, out of scope for MVP)
    if (this.policy.isGuarded(action)) {
      return 'guarded';
    }

    // If not explicitly in allowed list, still allow execution to proceed
    // This lets the executor handle unknown/invalid action types with a proper error
    // The policy only explicitly allows certain actions; others are implicitly handled by the executor

    // Check intervention limits
    const limits = this.policy.getLimits();
    const interventionCount = this.interventions.countForRun(run.id);

    if (interventionCount >= limits.maxInterventionsPerRun) {
      return 'denied';
    }

    // If the action targets a specific step, also check per-step limits
    if (candidate.parameters?.stepId && run.currentStepId) {
      const stepId = candidate.parameters.stepId as string;
      const stepAttemptCount = this.interventions.countForStep(run.id, stepId);
      if (stepAttemptCount >= limits.maxAttemptsPerStep) {
        return 'denied';
      }
    }

    // All checks passed
    return 'allowed';
  }
}
