import { describe, it, expect } from 'vitest';
import type { RuntimeEvent } from '../../services/watcher/types.js';
import type { DetectionContext, RuleResult } from '../../services/rule-engine/types.js';
import {
  stuckStepRule,
  repeatedErrorRule,
  infraFailureRule,
  timeoutRiskRule,
  resourcePressureRule,
  pullBackoffRule,
  schedulingFailureRule,
  evaluateAllRules,
  escalateResults,
} from '../../services/rule-engine/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Seconds ago from now */
function sAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

/** Make a minimal RuntimeEvent with required fields */
function makeEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    eventId: 'evt-1',
    runId: 'run-1',
    timestamp: sAgo(0),
    source: 'pod',
    kind: 'PodPhaseChanged',
    type: 'Running',
    severity: 'debug',
    message: 'test event',
    labels: { namespace: 'default' },
    payload: {},
    ...overrides,
  };
}

/** Make a DetectionContext with the given events */
function makeCtx(events: RuntimeEvent[], overrides: Partial<DetectionContext> = {}): DetectionContext {
  return {
    events,
    runId: 'run-1',
    ...overrides,
  };
}

// ─── stuckStepRule ─────────────────────────────────────────────────────────────

describe('stuckStepRule', () => {
  it('returns null when fewer than 2 non-progress events', () => {
    const ctx = makeCtx([makeEvent({ severity: 'debug' }), makeEvent({ severity: 'debug' })]);
    expect(stuckStepRule(ctx)).toBeNull();
  });

  it('returns null when latest progress event is recent (< 5 min)', () => {
    const events = [
      makeEvent({ severity: 'warning', message: 'First', timestamp: sAgo(600) }),
      makeEvent({ severity: 'warning', message: 'Last', timestamp: sAgo(60) }),
    ];
    expect(stuckStepRule(makeCtx(events))).toBeNull();
  });

  it('fires when no progress for over 5 minutes', () => {
    const events = [
      makeEvent({ severity: 'warning', message: 'Build started', timestamp: sAgo(600) }),
      makeEvent({ severity: 'warning', message: 'Still running', timestamp: sAgo(601) }), // older → latest
    ];
    const result = stuckStepRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('stuck-step');
    expect(result!.severity).toBe('warning');
    expect(result!.shouldEscalate).toBe(true);
    expect(result!.message).toContain('No progress detected');
  });

  it('returns critical severity when latest event is error', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'Error occurred', timestamp: sAgo(600) }),
      makeEvent({ severity: 'warning', message: 'Older', timestamp: sAgo(601) }),
    ];
    const result = stuckStepRule(makeCtx(events));
    expect(result!.severity).toBe('critical');
  });

  it('returns null when only debug/info events', () => {
    const events = [
      makeEvent({ severity: 'info', message: 'Started', timestamp: sAgo(600) }),
      makeEvent({ severity: 'debug', message: 'Debug', timestamp: sAgo(601) }),
    ];
    expect(stuckStepRule(makeCtx(events))).toBeNull();
  });
});

// ─── repeatedErrorRule ────────────────────────────────────────────────────────

describe('repeatedErrorRule', () => {
  it('returns null when fewer than 3 errors in window', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'error 1', timestamp: sAgo(60) }),
      makeEvent({ severity: 'error', message: 'error 2', timestamp: sAgo(61) }),
    ];
    expect(repeatedErrorRule(makeCtx(events))).toBeNull();
  });

  it('returns null when same error appears fewer than 3 times', () => {
    // Same error, only 2 occurrences
    const events = [
      makeEvent({ severity: 'error', message: 'Same error', timestamp: sAgo(60) }),
      makeEvent({ severity: 'error', message: 'Same error', timestamp: sAgo(61) }),
    ];
    expect(repeatedErrorRule(makeCtx(events))).toBeNull();
  });

  it('fires when same error appears 3 or more times in window', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'Connection refused', timestamp: sAgo(60) }),
      makeEvent({ severity: 'error', message: 'Connection refused', timestamp: sAgo(120) }),
      makeEvent({ severity: 'error', message: 'Connection refused', timestamp: sAgo(180) }),
    ];
    const result = repeatedErrorRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('repeated-error');
    expect(result!.severity).toBe('critical');
    expect(result!.shouldEscalate).toBe(true);
    expect(result!.message).toContain('3 times');
  });

  it('ignores errors outside the 10-minute window', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'Same error', timestamp: sAgo(60) }),
      makeEvent({ severity: 'error', message: 'Same error', timestamp: sAgo(120) }),
      // 11 minutes ago — outside 10-min window
      makeEvent({ severity: 'error', message: 'Same error', timestamp: sAgo(660) }),
    ];
    expect(repeatedErrorRule(makeCtx(events))).toBeNull();
  });

  it('differentiates different error signatures', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'Error A', timestamp: sAgo(60) }),
      makeEvent({ severity: 'error', message: 'Error B', timestamp: sAgo(120) }),
      makeEvent({ severity: 'error', message: 'Error C', timestamp: sAgo(180) }),
    ];
    // Each appears only once → no rule fires
    expect(repeatedErrorRule(makeCtx(events))).toBeNull();
  });
});

// ─── infraFailureRule ─────────────────────────────────────────────────────────

describe('infraFailureRule', () => {
  it('returns null when no infra failure events', () => {
    const events = [makeEvent({ source: 'pod', kind: 'PodPhaseChanged', type: 'Running' })];
    expect(infraFailureRule(makeCtx(events))).toBeNull();
  });

  it('fires on K8sWarningEvent', () => {
    const events = [
      makeEvent({ source: 'event', kind: 'K8sWarningEvent', severity: 'error', message: 'Node not ready' }),
    ];
    const result = infraFailureRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('infra-failure');
    expect(result!.severity).toBe('critical');
    expect(result!.shouldEscalate).toBe(true);
  });

  it('fires on PodTerminated with OOMKilled reason', () => {
    const events = [
      makeEvent({
        source: 'pod',
        kind: 'PodTerminated',
        payload: { reason: 'OOMKilled', message: 'Container oomkilled' },
      }),
    ];
    const result = infraFailureRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('infra-failure');
  });

  it('fires on PodTerminated with Failed reason', () => {
    const events = [
      makeEvent({
        source: 'pod',
        kind: 'PodTerminated',
        payload: { reason: 'Failed', message: 'Container failed' },
      }),
    ];
    const result = infraFailureRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('infra-failure');
  });

  it('returns null for PodTerminated with non-infra reason', () => {
    const events = [
      makeEvent({
        source: 'pod',
        kind: 'PodTerminated',
        payload: { reason: 'Completed', message: 'Container completed' },
      }),
    ];
    expect(infraFailureRule(makeCtx(events))).toBeNull();
  });
});

// ─── timeoutRiskRule ──────────────────────────────────────────────────────────

describe('timeoutRiskRule', () => {
  it('returns null when no Running pod events', () => {
    const events = [makeEvent({ source: 'pod', type: 'Pending', kind: 'PodPhaseChanged' })];
    expect(timeoutRiskRule(makeCtx(events))).toBeNull();
  });

  it('returns null when Running pod is recent (< 10 min)', () => {
    const events = [makeEvent({ source: 'pod', type: 'Running', kind: 'PodPhaseChanged', timestamp: sAgo(300) })];
    expect(timeoutRiskRule(makeCtx(events))).toBeNull();
  });

  it('fires when Running pod is older than 10 minutes', () => {
    const events = [makeEvent({ source: 'pod', type: 'Running', kind: 'PodPhaseChanged', timestamp: sAgo(900) })];
    const result = timeoutRiskRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('timeout-risk');
    expect(result!.severity).toBe('warning');
    expect(result!.shouldEscalate).toBe(false);
    expect(result!.message).toContain('may be approaching timeout');
  });
});

// ─── resourcePressureRule ─────────────────────────────────────────────────────

describe('resourcePressureRule', () => {
  it('returns null when no resource pressure indicators', () => {
    const events = [makeEvent({ message: 'Normal log line' })];
    expect(resourcePressureRule(makeCtx(events))).toBeNull();
  });

  it('fires on oomkilled in message', () => {
    const events = [makeEvent({ message: 'Container oomkilled — exit 137' })];
    const result = resourcePressureRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('resource-pressure');
    expect(result!.severity).toBe('critical');
    expect(result!.shouldEscalate).toBe(true);
  });

  it('fires on diskpressure in kind', () => {
    const events = [makeEvent({ kind: 'DiskPressure', message: 'Node disk pressure' })];
    const result = resourcePressureRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('resource-pressure');
  });

  it('fires on PodTerminated with OOMKilled reason', () => {
    const events = [
      makeEvent({
        source: 'pod',
        kind: 'PodTerminated',
        payload: { reason: 'OOMKilled' },
      }),
    ];
    expect(resourcePressureRule(makeCtx(events))).not.toBeNull();
  });
});

// ─── pullBackoffRule ──────────────────────────────────────────────────────────

describe('pullBackoffRule', () => {
  it('returns null when fewer than 2 pull-related events', () => {
    const events = [makeEvent({ message: 'Pulling image nginx:latest' })];
    expect(pullBackoffRule(makeCtx(events))).toBeNull();
  });

  it('fires when 2+ pull-related events appear', () => {
    const events = [
      makeEvent({ message: 'Pulling image nginx:latest', timestamp: sAgo(10) }),
      makeEvent({ message: 'Image pull backoff for nginx', timestamp: sAgo(20) }),
    ];
    const result = pullBackoffRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('pull-backoff');
    expect(result!.severity).toBe('warning');
    expect(result!.shouldEscalate).toBe(false);
  });

  it('returns null for non-pull messages even with warning severity', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'Build failed', timestamp: sAgo(10) }),
      makeEvent({ severity: 'error', message: 'Build failed again', timestamp: sAgo(20) }),
    ];
    expect(pullBackoffRule(makeCtx(events))).toBeNull();
  });
});

// ─── schedulingFailureRule ────────────────────────────────────────────────────

describe('schedulingFailureRule', () => {
  it('returns null when no Pending pods', () => {
    const events = [
      makeEvent({ source: 'pod', type: 'Running', kind: 'PodPhaseChanged' }),
    ];
    expect(schedulingFailureRule(makeCtx(events))).toBeNull();
  });

  it('returns null when a Running pod exists (pod was scheduled)', () => {
    const events = [
      makeEvent({ source: 'pod', type: 'Pending', kind: 'PodPhaseChanged', timestamp: sAgo(180) }),
      makeEvent({ source: 'pod', type: 'Running', kind: 'PodPhaseChanged', timestamp: sAgo(60) }),
    ];
    expect(schedulingFailureRule(makeCtx(events))).toBeNull();
  });

  it('returns null when Pending pod is recent (< 2 min)', () => {
    const events = [
      makeEvent({ source: 'pod', type: 'Pending', kind: 'PodPhaseChanged', timestamp: sAgo(60) }),
    ];
    expect(schedulingFailureRule(makeCtx(events))).toBeNull();
  });

  it('fires when Pending pod exists without Running pod for over 2 minutes', () => {
    const events = [
      makeEvent({ source: 'pod', type: 'Pending', kind: 'PodPhaseChanged', timestamp: sAgo(180) }),
    ];
    const result = schedulingFailureRule(makeCtx(events));
    expect(result).not.toBeNull();
    expect(result!.rule).toBe('scheduling-failure');
    expect(result!.severity).toBe('critical');
    expect(result!.shouldEscalate).toBe(true);
    expect(result!.message).toContain('Pending');
  });
});

// ─── evaluateAllRules ─────────────────────────────────────────────────────────

describe('evaluateAllRules', () => {
  it('returns empty array when no rules fire', () => {
    const ctx = makeCtx([makeEvent({ severity: 'info', message: 'all good' })]);
    expect(evaluateAllRules(ctx)).toEqual([]);
  });

  it('returns results from all rules that fire', () => {
    const events = [
      makeEvent({ source: 'event', kind: 'K8sWarningEvent', severity: 'error', message: 'Node not ready' }),
      makeEvent({ message: 'Container oomkilled' }),
    ];
    const results = evaluateAllRules(makeCtx(events));
    const rules = results.map((r) => r.rule);
    expect(rules).toContain('infra-failure');
    expect(rules).toContain('resource-pressure');
  });

  it('deduplicates: same rule fires twice → only one result', () => {
    // Two infra events should still only produce one infra-failure result
    const events = [
      makeEvent({ source: 'event', kind: 'K8sWarningEvent', severity: 'error', message: 'Event 1' }),
      makeEvent({ source: 'event', kind: 'K8sWarningEvent', severity: 'error', message: 'Event 2' }),
    ];
    const results = evaluateAllRules(makeCtx(events));
    const infraResults = results.filter((r) => r.rule === 'infra-failure');
    expect(infraResults).toHaveLength(1);
  });

  it('includes runId and stepId in results', () => {
    const events = [
      makeEvent({ source: 'event', kind: 'K8sWarningEvent', severity: 'error', message: 'fail' }),
    ];
    const results = evaluateAllRules(makeCtx(events, { runId: 'run-99', stepRunId: 'step-5' }));
    expect(results[0].runId).toBe('run-99');
    expect(results[0].stepId).toBe('step-5');
  });
});

// ─── escalateResults ─────────────────────────────────────────────────────────

describe('escalateResults', () => {
  it('returns only results with shouldEscalate: true', () => {
    const results: RuleResult[] = [
      { rule: 'stuck-step', severity: 'warning', runId: 'run-1', message: '', evidence: [], shouldEscalate: true, timestamp: sAgo(0) },
      { rule: 'timeout-risk', severity: 'warning', runId: 'run-1', message: '', evidence: [], shouldEscalate: false, timestamp: sAgo(0) },
      { rule: 'infra-failure', severity: 'critical', runId: 'run-1', message: '', evidence: [], shouldEscalate: true, timestamp: sAgo(0) },
    ];
    const escalated = escalateResults(results);
    expect(escalated).toHaveLength(2);
    expect(escalated.map((r) => r.rule)).toContain('stuck-step');
    expect(escalated.map((r) => r.rule)).toContain('infra-failure');
    expect(escalated.map((r) => r.rule)).not.toContain('timeout-risk');
  });

  it('returns empty array when no results should escalate', () => {
    const results: RuleResult[] = [
      { rule: 'timeout-risk', severity: 'warning', runId: 'run-1', message: '', evidence: [], shouldEscalate: false, timestamp: sAgo(0) },
      { rule: 'pull-backoff', severity: 'warning', runId: 'run-1', message: '', evidence: [], shouldEscalate: false, timestamp: sAgo(0) },
    ];
    expect(escalateResults(results)).toEqual([]);
  });
});

// ─── Replay scenarios ─────────────────────────────────────────────────────────

describe('replay scenarios', () => {
  it('scenario: pod stuck in Pending → scheduling-failure fires', () => {
    const events = [
      makeEvent({ source: 'pod', type: 'Pending', kind: 'PodPhaseChanged', timestamp: sAgo(200), message: 'Pod pending' }),
    ];
    const results = evaluateAllRules(makeCtx(events));
    const rules = results.map((r) => r.rule);
    expect(rules).toContain('scheduling-failure');
  });

  it('scenario: 3 identical errors in 10 min window → repeated-error fires', () => {
    const events = [
      makeEvent({ severity: 'error', message: 'ERROR: connection refused', timestamp: sAgo(60) }),
      makeEvent({ severity: 'error', message: 'ERROR: connection refused', timestamp: sAgo(120) }),
      makeEvent({ severity: 'error', message: 'ERROR: connection refused', timestamp: sAgo(180) }),
    ];
    const results = evaluateAllRules(makeCtx(events));
    const rules = results.map((r) => r.rule);
    expect(rules).toContain('repeated-error');
  });

  it('scenario: OOMKilled → infra-failure and resource-pressure both fire', () => {
    const events = [
      makeEvent({
        source: 'pod',
        kind: 'PodTerminated',
        payload: { reason: 'OOMKilled', message: 'Container oomkilled' },
        severity: 'error',
      }),
    ];
    const results = evaluateAllRules(makeCtx(events));
    const rules = results.map((r) => r.rule);
    expect(rules).toContain('infra-failure');
    expect(rules).toContain('resource-pressure');
  });

  it('scenario: healthy run → no rules fire', () => {
    const events = [
      makeEvent({ source: 'pod', type: 'Running', kind: 'PodPhaseChanged', severity: 'debug', message: 'Pod started' }),
      makeEvent({ source: 'pod', type: 'Succeeded', kind: 'PodPhaseChanged', severity: 'info', message: 'Build succeeded' }),
    ];
    const results = evaluateAllRules(makeCtx(events));
    expect(results).toEqual([]);
  });
});
