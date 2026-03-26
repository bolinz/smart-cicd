import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyStore } from '../../services/action-engine/policy-store';
import { ActionValidator } from '../../services/action-engine/validator';
import { InterventionStore } from '../../services/action-engine/intervention-store';
import type { CandidateAction, InterventionRecord } from '../../services/action-engine/types';
import type { ActionType, PipelineRun } from '../../services/control-plane/types';
import type { PolicyDecision } from '../../services/action-engine/validator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(action: ActionType, parameters?: Record<string, unknown>): CandidateAction {
  return {
    action,
    parameters,
    score: 0.8,
    reason: `Test candidate for ${action}`,
  };
}

function makeRun(runId = 'run-1'): PipelineRun {
  return {
    id: runId,
    specId: 'spec-1',
    status: 'running',
    riskLevel: 'low',
    attemptCounts: {},
  };
}

function makeRecord(runId: string, stepId: string, actionType: ActionType): InterventionRecord {
  return {
    id: `int-${Math.random().toString(36).slice(2)}`,
    runId,
    stepId,
    triggerReason: 'test',
    actionType,
    actionParameters: {},
    policyDecision: 'allowed',
    timestamp: new Date().toISOString(),
  };
}

// ─── PolicyStore ──────────────────────────────────────────────────────────────

describe('PolicyStore', () => {
  let store: PolicyStore;

  beforeEach(() => {
    store = new PolicyStore();
  });

  it('rerun-step is allowed', () => {
    expect(store.isAllowed('rerun-step')).toBe(true);
  });

  it('clear-cache-and-rerun is allowed', () => {
    expect(store.isAllowed('clear-cache-and-rerun')).toBe(true);
  });

  it('restart-runner-pod is allowed', () => {
    expect(store.isAllowed('restart-runner-pod')).toBe(true);
  });

  it('stop-run is allowed', () => {
    expect(store.isAllowed('stop-run')).toBe(true);
  });

  it('increase-resources is guarded', () => {
    expect(store.isGuarded('increase-resources')).toBe(true);
    expect(store.isAllowed('increase-resources')).toBe(false);
  });

  it('adjust-timeout is guarded', () => {
    expect(store.isGuarded('adjust-timeout')).toBe(true);
    expect(store.isAllowed('adjust-timeout')).toBe(false);
  });

  // Note: deploy-production, modify-rbac, rotate-secrets are not in ActionType
  // so they cannot be tested via isAllowed/isGuarded (which require ActionType)
  // They are only tested via isForbidden which accepts string
  it('deploy-production is forbidden (via isForbidden string overload)', () => {
    expect(store.isForbidden('deploy-production')).toBe(true);
  });

  it('modify-rbac is forbidden (via isForbidden string overload)', () => {
    expect(store.isForbidden('modify-rbac')).toBe(true);
  });

  it('rotate-secrets is forbidden (via isForbidden string overload)', () => {
    expect(store.isForbidden('rotate-secrets')).toBe(true);
  });

  it('getLimits returns correct values', () => {
    const limits = store.getLimits();
    expect(limits.maxAttemptsPerStep).toBe(3);
    expect(limits.maxInterventionsPerRun).toBe(5);
    expect(limits.resourceBumpLimit).toBe('2x');
    expect(limits.timeoutAdjustmentLimitMs).toBe(300000);
  });
});

// ─── ActionValidator ──────────────────────────────────────────────────────────

describe('ActionValidator', () => {
  let store: InterventionStore;
  let policy: PolicyStore;
  let validator: ActionValidator;
  let run: PipelineRun;

  beforeEach(() => {
    store = new InterventionStore();
    policy = new PolicyStore();
    validator = new ActionValidator(policy, store);
    run = makeRun('run-1');
  });

  it('returns allowed for rerun-step', () => {
    const result = validator.validateAction(makeCandidate('rerun-step'), run);
    expect(result).toBe('allowed');
  });

  it('returns allowed for clear-cache-and-rerun', () => {
    const result = validator.validateAction(makeCandidate('clear-cache-and-rerun'), run);
    expect(result).toBe('allowed');
  });

  it('returns allowed for restart-runner-pod', () => {
    const result = validator.validateAction(makeCandidate('restart-runner-pod'), run);
    expect(result).toBe('allowed');
  });

  it('returns allowed for stop-run', () => {
    const result = validator.validateAction(makeCandidate('stop-run'), run);
    expect(result).toBe('allowed');
  });

  it('returns guarded for increase-resources', () => {
    const result = validator.validateAction(makeCandidate('increase-resources'), run);
    expect(result).toBe('guarded');
  });

  it('returns guarded for adjust-timeout', () => {
    const result = validator.validateAction(makeCandidate('adjust-timeout'), run);
    expect(result).toBe('guarded');
  });

  // Note: deploy-production, modify-rbac, rotate-secrets are not in ActionType
  // They cannot be proposed as candidate actions, so we cannot test them via validateAction
  // They are tested separately via PolicyStore.isForbidden

  it('denies when maxInterventionsPerRun is exceeded', () => {
    const limits = policy.getLimits();
    // Add maxInterventionsPerRun records to the store
    for (let i = 0; i < limits.maxInterventionsPerRun; i++) {
      store.save(makeRecord('run-1', `step-${i}`, 'rerun-step'));
    }
    // Next intervention should be denied
    const result = validator.validateAction(makeCandidate('rerun-step'), run);
    expect(result).toBe('denied');
  });

  it('allows interventions within maxInterventionsPerRun limit', () => {
    const limits = policy.getLimits();
    // Add maxInterventionsPerRun - 1 records
    for (let i = 0; i < limits.maxInterventionsPerRun - 1; i++) {
      store.save(makeRecord('run-1', `step-${i}`, 'rerun-step'));
    }
    // Next intervention should still be allowed
    const result = validator.validateAction(makeCandidate('rerun-step'), run);
    expect(result).toBe('allowed');
  });
});

// ─── InterventionStore ────────────────────────────────────────────────────────

describe('InterventionStore', () => {
  let store: InterventionStore;

  beforeEach(() => {
    store = new InterventionStore();
  });

  it('saves and retrieves records for a run', () => {
    const record1 = makeRecord('run-1', 'step-1', 'rerun-step');
    const record2 = makeRecord('run-1', 'step-2', 'stop-run');
    store.save(record1);
    store.save(record2);

    const records = store.getForRun('run-1');
    expect(records).toHaveLength(2);
  });

  it('saves and retrieves records for a step', () => {
    const record1 = makeRecord('run-1', 'step-1', 'rerun-step');
    const record2 = makeRecord('run-1', 'step-2', 'stop-run');
    store.save(record1);
    store.save(record2);

    const records = store.getForStep('run-1', 'step-1');
    expect(records).toHaveLength(1);
    expect(records[0].stepId).toBe('step-1');
  });

  it('counts records for a run', () => {
    store.save(makeRecord('run-1', 'step-1', 'rerun-step'));
    store.save(makeRecord('run-1', 'step-2', 'stop-run'));
    store.save(makeRecord('run-2', 'step-1', 'rerun-step'));

    expect(store.countForRun('run-1')).toBe(2);
    expect(store.countForRun('run-2')).toBe(1);
  });

  it('counts records for a step', () => {
    store.save(makeRecord('run-1', 'step-1', 'rerun-step'));
    store.save(makeRecord('run-1', 'step-1', 'stop-run'));
    store.save(makeRecord('run-1', 'step-2', 'rerun-step'));

    expect(store.countForStep('run-1', 'step-1')).toBe(2);
    expect(store.countForStep('run-1', 'step-2')).toBe(1);
  });

  it('clears all records', () => {
    store.save(makeRecord('run-1', 'step-1', 'rerun-step'));
    store.save(makeRecord('run-1', 'step-2', 'stop-run'));
    store.clear();
    expect(store.countForRun('run-1')).toBe(0);
  });
});

// ─── Executor ─────────────────────────────────────────────────────────────────

describe('InterventionExecutor', () => {
  // Note: Full executor tests would require mocking k8sApi
  // These tests cover the basic action routing and callback behavior

  it('returns failure for unknown action type', async () => {
    // We can't directly test the executor without a real k8sApi,
    // but we can verify the routing by checking the switch is exhaustive
    // For unit tests, we test via the createActionEngine helper
    const { createActionEngine } = await import('../../services/action-engine/index');

    let called = false;
    const engine = createActionEngine({
      k8sApi: {} as any,
      onRerunStep: () => { called = true; },
      onStopRun: () => {},
    });

    // The unknown action should be caught and return failure
    const record = await engine.requestIntervention({
      runId: 'run-1',
      stepId: 'step-1',
      candidate: {
        action: 'unknown-action' as ActionType,
        score: 0.5,
        reason: 'test',
      },
    });

    expect(record.executionResult?.success).toBe(false);
    expect(record.executionResult?.message).toContain('Unknown action');
  });
});
