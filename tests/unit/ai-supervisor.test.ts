import { describe, it, expect, beforeEach } from 'vitest';
import type { RuntimeEvent } from '../../services/watcher/types.js';
import type { RuleResult } from '../../services/rule-engine/types.js';
import { createAisSupervisor } from '../../services/ai-supervisor/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

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

function makeRuleResult(overrides: Partial<RuleResult> = {}): RuleResult {
  return {
    rule: 'stuck-step',
    severity: 'warning',
    runId: 'run-1',
    message: 'no progress detected',
    evidence: ['event at 10:00', 'event at 10:05'],
    shouldEscalate: true,
    timestamp: sAgo(0),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AisSupervisor', () => {
  let supervisor: ReturnType<typeof createAisSupervisor>;

  beforeEach(() => {
    supervisor = createAisSupervisor();
  });

  // ── Structure ─────────────────────────────────────────────────────────────

  it('diagnose() returns a DiagnosisRecord with all required fields', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-abc',
      events: [],
      ruleResults: [],
    });

    expect(record).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      runId: 'run-abc',
      source: 'ai-supervisor',
      rankedActions: expect.any(Array),
      evidence: expect.any(Array),
    });
    expect(typeof record.confidence).toBe('number');
    expect(record.confidence).toBeGreaterThanOrEqual(0);
    expect(record.confidence).toBeLessThanOrEqual(1);
    expect(record.riskLevel).toMatch(/^(low|medium|high|critical)$/);
  });

  it('diagnose() accepts stepId', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-abc',
      stepId: 'step-build',
      events: [],
      ruleResults: [],
    });

    expect(record.stepId).toBe('step-build');
  });

  // ── Risk level derivation ─────────────────────────────────────────────────

  it('returns critical risk when any rule is critical severity', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'infra-failure', severity: 'critical', message: 'OOMKilled' }),
      ],
    });

    expect(record.riskLevel).toBe('critical');
  });

  it('returns high risk when all rules are warning severity', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'stuck-step', severity: 'warning' }),
        makeRuleResult({ rule: 'timeout-risk', severity: 'warning' }),
      ],
    });

    expect(record.riskLevel).toBe('high');
  });

  it('returns medium risk when rule list is empty', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [],
    });

    expect(record.riskLevel).toBe('medium');
  });

  // ── Confidence scoring ────────────────────────────────────────────────────

  it('confidence increases with more distinct rule types', async () => {
    const [one, two, three] = await Promise.all([
      supervisor.diagnose({ runId: 'run-1', events: [], ruleResults: [makeRuleResult({ rule: 'stuck-step' })] }),
      supervisor.diagnose({
        runId: 'run-1',
        events: [],
        ruleResults: [
          makeRuleResult({ rule: 'stuck-step' }),
          makeRuleResult({ rule: 'repeated-error' }),
        ],
      }),
      supervisor.diagnose({
        runId: 'run-1',
        events: [],
        ruleResults: [
          makeRuleResult({ rule: 'stuck-step' }),
          makeRuleResult({ rule: 'repeated-error' }),
          makeRuleResult({ rule: 'infra-failure' }),
        ],
      }),
    ]);

    expect(one.confidence).toBeLessThan(two.confidence);
    expect(two.confidence).toBeLessThan(three.confidence);
  });

  it('critical severity boosts confidence more than warning', async () => {
    const [warn, crit] = await Promise.all([
      supervisor.diagnose({
        runId: 'run-1',
        events: Array.from({ length: 10 }, () => makeEvent()),
        ruleResults: [makeRuleResult({ severity: 'warning' })],
      }),
      supervisor.diagnose({
        runId: 'run-1',
        events: Array.from({ length: 10 }, () => makeEvent()),
        ruleResults: [makeRuleResult({ severity: 'critical' })],
      }),
    ]);

    expect(crit.confidence).toBeGreaterThan(warn.confidence);
  });

  // ── Summary generation ───────────────────────────────────────────────────

  it('summary contains rule names and messages', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'stuck-step', message: 'no progress for 300s' }),
        makeRuleResult({ rule: 'repeated-error', message: 'same error repeated 5 times' }),
      ],
    });

    expect(record.summary).toContain('stuck-step');
    expect(record.summary).toContain('repeated-error');
    expect(record.summary).toContain('no progress');
  });

  it('empty ruleResults gives generic summary', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [],
    });

    expect(record.summary).toBe('No specific rule violations detected.');
  });

  // ── Evidence aggregation ─────────────────────────────────────────────────

  it('evidence includes rule result evidence', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ evidence: ['evidence item 1', 'evidence item 2'] }),
      ],
    });

    expect(record.evidence).toContain('evidence item 1');
    expect(record.evidence).toContain('evidence item 2');
  });

  it('evidence caps at 10 items', async () => {
    const manyEvents = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ eventId: `e${i}`, message: `error message ${i}`, severity: 'error' }),
    );
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: manyEvents,
      ruleResults: [
        makeRuleResult({ evidence: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10'] }),
      ],
    });

    expect(record.evidence.length).toBeLessThanOrEqual(10);
  });

  // ── Action ranking ───────────────────────────────────────────────────────

  it('rankedActions are sorted by score descending', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'stuck-step', severity: 'critical' }),
      ],
    });

    const scores = record.rankedActions.map((a) => a.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('rerun-step scores high when stuck-step rule fires', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [makeRuleResult({ rule: 'stuck-step' })],
    });

    const rerun = record.rankedActions.find((a) => a.action === 'rerun-step');
    expect(rerun).toBeDefined();
    expect(rerun!.score).toBeGreaterThanOrEqual(0.8);
  });

  it('restart-runner-pod scores high when infra-failure rule fires', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [makeRuleResult({ rule: 'infra-failure', severity: 'critical' })],
    });

    const restart = record.rankedActions.find((a) => a.action === 'restart-runner-pod');
    expect(restart).toBeDefined();
    expect(restart!.score).toBeGreaterThanOrEqual(0.75);
  });

  it('clear-cache-and-rerun scores higher when build error repeats', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({
          rule: 'repeated-error',
          severity: 'critical',
          message: 'build failed with exit code 1',
        }),
      ],
    });

    const clear = record.rankedActions.find((a) => a.action === 'clear-cache-and-rerun');
    expect(clear).toBeDefined();
    expect(clear!.score).toBeGreaterThanOrEqual(0.7);
  });

  it('stop-run scores high when multiple critical rules fire', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'infra-failure', severity: 'critical' }),
        makeRuleResult({ rule: 'repeated-error', severity: 'critical' }),
      ],
    });

    const stop = record.rankedActions.find((a) => a.action === 'stop-run');
    expect(stop).toBeDefined();
    expect(stop!.score).toBeGreaterThanOrEqual(0.6);
  });

  it('stop-run scores highest when OOMKilled infra failure fires', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'infra-failure', severity: 'critical', message: 'Pod OOMKilled: memory limit exceeded' }),
      ],
    });

    const stop = record.rankedActions.find((a) => a.action === 'stop-run');
    expect(stop).toBeDefined();
    expect(stop!.score).toBeGreaterThanOrEqual(0.7);
  });

  it('increase-resources scores higher when resource-pressure fires', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [makeRuleResult({ rule: 'resource-pressure' })],
    });

    const increase = record.rankedActions.find((a) => a.action === 'increase-resources');
    expect(increase).toBeDefined();
    expect(increase!.score).toBeGreaterThan(0.3);
  });

  it('guarded actions have lower effective score than allowed actions', async () => {
    // With a neutral rule set, rerun-step (allowed) should outrank increase-resources (guarded)
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: Array.from({ length: 10 }, () => makeEvent()),
      ruleResults: [
        makeRuleResult({ rule: 'stuck-step', severity: 'warning' }),
        makeRuleResult({ rule: 'timeout-risk', severity: 'warning' }),
      ],
    });

    const rerun = record.rankedActions.find((a) => a.action === 'rerun-step');
    const increase = record.rankedActions.find((a) => a.action === 'increase-resources');
    expect(rerun && increase).toBeTruthy();
    expect(rerun!.score).toBeGreaterThan(increase!.score);
  });

  it('adjust-timeout scores higher when timeout-risk fires', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [makeRuleResult({ rule: 'timeout-risk' })],
    });

    const adjust = record.rankedActions.find((a) => a.action === 'adjust-timeout');
    expect(adjust).toBeDefined();
    expect(adjust!.score).toBeGreaterThan(0.2);
  });

  it('all six known actions appear in rankedActions', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'stuck-step', severity: 'critical' }),
        makeRuleResult({ rule: 'repeated-error', severity: 'critical' }),
        makeRuleResult({ rule: 'infra-failure', severity: 'critical' }),
        makeRuleResult({ rule: 'resource-pressure', severity: 'critical' }),
        makeRuleResult({ rule: 'timeout-risk', severity: 'warning' }),
        makeRuleResult({ rule: 'pull-backoff', severity: 'warning' }),
      ],
    });

    const actions = record.rankedActions.map((a) => a.action);
    expect(actions).toContain('rerun-step');
    expect(actions).toContain('clear-cache-and-rerun');
    expect(actions).toContain('restart-runner-pod');
    expect(actions).toContain('stop-run');
    expect(actions).toContain('increase-resources');
    expect(actions).toContain('adjust-timeout');
  });

  it('rankedActions include reason strings', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [makeRuleResult({ rule: 'stuck-step' })],
    });

    for (const action of record.rankedActions) {
      expect(typeof action.reason).toBe('string');
      expect(action.reason.length).toBeGreaterThan(0);
    }
  });

  it('increase-resources and adjust-timeout include parameters', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [makeRuleResult({ rule: 'timeout-risk', severity: 'warning' })],
    });

    const increase = record.rankedActions.find((a) => a.action === 'increase-resources');
    const adjust = record.rankedActions.find((a) => a.action === 'adjust-timeout');
    expect(increase?.parameters).toEqual({ resourceMultiplier: 2 });
    expect(adjust?.parameters).toEqual({ timeoutMs: 300000 });
  });

  // ── Mixed severity rules ─────────────────────────────────────────────────

  it('critical rules dominate risk level over warnings', async () => {
    const record = await supervisor.diagnose({
      runId: 'run-1',
      events: [],
      ruleResults: [
        makeRuleResult({ rule: 'stuck-step', severity: 'warning' }),
        makeRuleResult({ rule: 'infra-failure', severity: 'critical' }),
      ],
    });

    expect(record.riskLevel).toBe('critical');
  });
});
