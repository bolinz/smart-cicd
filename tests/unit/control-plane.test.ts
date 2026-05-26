import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuid } from 'uuid';
import type { PipelineSpec, GraphStep, RunStatus, StepStatus, RiskLevel } from '../../services/control-plane/types.js';
import type { RuntimeEvent } from '../../services/watcher/types.js';
import type { RuleResult } from '../../services/rule-engine/types.js';
import type { DiagnosisRecord } from '../../services/ai-supervisor/types.js';
import type { InterventionRecord } from '../../services/action-engine/types.js';
import type { CandidateAction } from '../../services/action-engine/types.js';
import { compileSpec } from '../../services/control-plane/spec-compiler.js';
import { RunnerManager } from '../../services/control-plane/runner-manager.js';
import { RunOrchestrator } from '../../services/control-plane/orchestrator.js';
import type { AisSupervisorStub, ActionEngineStub } from '../../services/control-plane/orchestrator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function makeRuleResult(overrides: Partial<RuleResult> = {}): RuleResult {
  return {
    rule: 'stuck-step',
    severity: 'warning',
    runId: 'run-1',
    message: 'stuck',
    evidence: [],
    shouldEscalate: true,
    timestamp: sAgo(0),
    ...overrides,
  };
}

function makeRuntimeEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    eventId: uuid(),
    runId: 'run-1',
    timestamp: sAgo(0),
    source: 'pod',
    kind: 'PodPhaseChanged',
    type: 'Running',
    severity: 'debug',
    message: 'test',
    labels: { namespace: 'default' },
    payload: {},
    ...overrides,
  };
}

function makeSpec(overrides: Partial<PipelineSpec> = {}): PipelineSpec {
  return {
    id: 'spec-1',
    sourceRepo: 'https://github.com/test/repo',
    ref: 'main',
    stages: [
      {
        id: 'build',
        name: 'Build',
        steps: [
          { id: 'compile', name: 'Compile', image: 'golang:1.21', commands: ['go build ./...'] },
        ],
      },
    ],
    runtime: { builder: 'buildkit', executorImage: 'smart-cicd/executor:latest' },
    ...overrides,
  };
}

function makeGraphStep(overrides: Partial<GraphStep> = {}): GraphStep {
  return {
    id: 'compile',
    stageId: 'build',
    step: { id: 'compile', name: 'Compile', image: 'golang:1.21', commands: ['go build ./...'] },
    eligibleActions: ['rerun-step'],
    ...overrides,
  };
}

// ─── compileSpec ────────────────────────────────────────────────────────────────

describe('compileSpec', () => {
  it('produces a RunGraph with one step', () => {
    const spec = makeSpec({
      stages: [{ id: 's1', name: 'Stage 1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });
    const { graph, errors } = compileSpec(spec);
    expect(errors).toHaveLength(0);
    expect(graph.steps).toHaveLength(1);
    expect(graph.steps[0].id).toBe('step1');
    expect(graph.specId).toBe('spec-1');
  });

  it('produces step dependencies from stage dependsOn', () => {
    const spec = makeSpec({
      stages: [
        { id: 'build', name: 'Build', steps: [{ id: 'compile', name: 'Compile', image: 'img', commands: ['go build'] }] },
        { id: 'test', name: 'Test', steps: [{ id: 'test', name: 'Test', image: 'img', commands: ['go test'] }], dependsOn: ['build'] },
      ],
    });
    const { graph, errors } = compileSpec(spec);
    expect(errors).toHaveLength(0);
    expect(graph.dependencies['test']).toContain('compile');
    expect(graph.dependencies['compile']).toHaveLength(0);
  });

  it('returns errors for empty spec.id', () => {
    const { errors } = compileSpec(makeSpec({ id: '' }));
    expect(errors).toContain('spec.id is required');
  });

  it('returns errors for missing stages', () => {
    const { errors } = compileSpec(makeSpec({ stages: [] }));
    expect(errors).toContain('at least one stage is required');
  });

  it('returns errors for duplicate stage ids', () => {
    const spec = makeSpec({
      stages: [
        { id: 'build', name: 'Build', steps: [{ id: 's1', name: 'S1', image: 'img', commands: ['echo'] }] },
        { id: 'build', name: 'Build2', steps: [{ id: 's2', name: 'S2', image: 'img', commands: ['echo'] }] },
      ],
    });
    const { errors } = compileSpec(spec);
    expect(errors).toContain('duplicate stage id: build');
  });

  it('returns errors for duplicate step ids across stages', () => {
    const spec = makeSpec({
      stages: [
        { id: 's1', name: 'S1', steps: [{ id: 'same', name: 'Same', image: 'img', commands: ['echo'] }] },
        { id: 's2', name: 'S2', steps: [{ id: 'same', name: 'Same', image: 'img', commands: ['echo'] }] },
      ],
    });
    const { errors } = compileSpec(spec);
    expect(errors).toContain('duplicate step id: same');
  });

  it('returns errors for unknown dependsOn reference', () => {
    const spec = makeSpec({
      stages: [
        { id: 'build', name: 'Build', steps: [{ id: 'compile', name: 'Compile', image: 'img', commands: ['go build'] }] },
        { id: 'test', name: 'Test', steps: [{ id: 'test', name: 'Test', image: 'img', commands: ['go test'] }], dependsOn: ['nonexistent'] },
      ],
    });
    const { errors } = compileSpec(spec);
    expect(errors.some((e) => e.includes('unknown stage'))).toBe(true);
  });

  it('assigns all eligible actions to each step', () => {
    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo'] }] }],
    });
    const { graph } = compileSpec(spec);
    expect(graph.steps[0].eligibleActions).toContain('rerun-step');
    expect(graph.steps[0].eligibleActions).toContain('stop-run');
    expect(graph.steps[0].eligibleActions).toContain('increase-resources');
  });

  it('sets stageId on each graph step', () => {
    const spec = makeSpec({
      stages: [{ id: 'my-stage', name: 'My Stage', steps: [{ id: 'my-step', name: 'My Step', image: 'img', commands: ['echo'] }] }],
    });
    const { graph } = compileSpec(spec);
    expect(graph.steps[0].stageId).toBe('my-stage');
  });

  it('returns errors for circular stage dependencies', () => {
    const spec = makeSpec({
      stages: [
        { id: 'a', name: 'A', steps: [{ id: 's1', name: 'S1', image: 'img', commands: ['echo'] }], dependsOn: ['c'] },
        { id: 'b', name: 'B', steps: [{ id: 's2', name: 'S2', image: 'img', commands: ['echo'] }], dependsOn: ['a'] },
        { id: 'c', name: 'C', steps: [{ id: 's3', name: 'S3', image: 'img', commands: ['echo'] }], dependsOn: ['b'] },
      ],
    });
    const { errors } = compileSpec(spec);
    expect(errors.some((e) => e.includes('circular dependency'))).toBe(true);
  });
});

// ─── RunnerManager ─────────────────────────────────────────────────────────────

describe('RunnerManager', () => {
  const mockBatchApi = { createNamespacedJob: vi.fn() } as any;
  const mockCoreApi = {} as any;

  function makeRM(): RunnerManager {
    return new RunnerManager(
      { namespace: 'default' },
      { k8sApi: mockCoreApi, batchApi: mockBatchApi },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a JobSpec with correct labels', () => {
    const rm = makeRM();
    const run = { id: 'run-abc', specId: 'spec-1', status: 'running' as RunStatus, riskLevel: 'low' as RiskLevel, attemptCounts: {} };
    const step: GraphStep = makeGraphStep({ id: 'compile', step: { id: 'compile', name: 'Compile', image: 'golang:1.21', commands: ['go build ./...'] } });

    const { jobManifest } = rm.createStepRun({ run, step, attemptNumber: 1 });

    const meta = jobManifest.metadata as Record<string, unknown>;
    const labels = meta.labels as Record<string, string>;
    expect(labels.run_id).toBe('run-abc');
    expect(labels.step_id).toBe('compile');
    expect(labels.step_run_id).toContain('run-abc');
  });

  it('sets backoffLimit from retry policy', () => {
    const rm = makeRM();
    const run = { id: 'run-abc', specId: 'spec-1', status: 'running' as RunStatus, riskLevel: 'low' as RiskLevel, attemptCounts: {} };
    const step: GraphStep = makeGraphStep();

    const { jobManifest } = rm.createStepRun({
      run,
      step,
      attemptNumber: 1,
      retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
    });

    const spec = jobManifest.spec as Record<string, unknown>;
    expect(spec.backoffLimit).toBe(3);
  });

  it('injects RUN_ID, STEP_ID, STEP_RUN_ID, ATTEMPT env vars', () => {
    const rm = makeRM();
    const run = { id: 'run-xyz', specId: 'spec-1', status: 'running' as RunStatus, riskLevel: 'low' as RiskLevel, attemptCounts: {} };
    const step: GraphStep = makeGraphStep({ id: 'build', step: { id: 'build', name: 'Build', image: 'img', commands: ['make'] } });

    const { jobManifest } = rm.createStepRun({ run, step, attemptNumber: 2 });

    const template = (jobManifest.spec as Record<string, unknown>).template as Record<string, unknown>;
    const podSpec = template.spec as Record<string, unknown>;
    const containers = podSpec.containers as Array<Record<string, unknown>>;
    const env = containers[0].env as Array<{ name: string; value: string }>;

    expect(env.find((e) => e.name === 'RUN_ID')?.value).toBe('run-xyz');
    expect(env.find((e) => e.name === 'STEP_ID')?.value).toBe('build');
    expect(env.find((e) => e.name === 'ATTEMPT')?.value).toBe('2');
    expect(env.find((e) => e.name === 'STEP_RUN_ID')?.value).toContain('run-xyz');
  });

  it('wraps commands in bash -c with set -e', () => {
    const rm = makeRM();
    const run = { id: 'run-abc', specId: 'spec-1', status: 'running' as RunStatus, riskLevel: 'low' as RiskLevel, attemptCounts: {} };
    const step: GraphStep = makeGraphStep({
      step: { id: 'compile', name: 'Compile', image: 'img', commands: ['go build ./...', 'go test ./...'] },
    });

    const { jobManifest } = rm.createStepRun({ run, step, attemptNumber: 1 });

    const template = (jobManifest.spec as Record<string, unknown>).template as Record<string, unknown>;
    const podSpec = template.spec as Record<string, unknown>;
    const containers = podSpec.containers as Array<Record<string, unknown>>;
    const cmd = containers[0].command as string[];

    expect(cmd).toContain('/bin/bash');
    expect(cmd).toContain('-c');
    const script = cmd[cmd.length - 1];
    expect(script).toContain('go build ./...');
    expect(script).toContain('go test ./...');
    expect(script).toContain('set -e');
  });

  it('submitJob calls batchApi.createNamespacedJob', async () => {
    const rm = makeRM();
    const run = { id: 'run-abc', specId: 'spec-1', status: 'running' as RunStatus, riskLevel: 'low' as RiskLevel, attemptCounts: {} };
    const step: GraphStep = makeGraphStep();
    const { jobManifest } = rm.createStepRun({ run, step, attemptNumber: 1 });

    mockBatchApi.createNamespacedJob.mockResolvedValue({ body: {} });

    await rm.submitJob(jobManifest);

    expect(mockBatchApi.createNamespacedJob).toHaveBeenCalledWith('default', jobManifest);
  });
});

// ─── RunOrchestrator ───────────────────────────────────────────────────────────

describe('RunOrchestrator', () => {
  function makeStubAisSupervisor(): AisSupervisorStub {
    return {
      diagnose: vi.fn().mockResolvedValue({
        id: 'diag-1',
        runId: 'run-1',
        source: 'ai-supervisor' as const,
        confidence: 0.9,
        summary: 'test diagnosis',
        evidence: [],
        rankedActions: [],
        riskLevel: 'medium' as const,
        timestamp: sAgo(0),
      }),
    } as any;
  }

  function makeStubActionEngine(): ActionEngineStub {
    return {
      requestIntervention: vi.fn().mockResolvedValue({
        id: 'int-1',
        runId: 'run-1',
        triggerReason: 'test',
        actionType: 'rerun-step' as const,
        actionParameters: {},
        policyDecision: 'allowed' as const,
        timestamp: sAgo(0),
      }),
    } as any;
  }

  function makeStubRunnerManager() {
    return {
      createStepRun: vi.fn().mockReturnValue({
        jobName: 'test-job',
        podName: 'test-pod',
        stepRunId: 'run-1-compile-attempt-1',
        jobManifest: { apiVersion: 'batch/v1', kind: 'Job' },
      }),
      submitJob: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('createRun produces a pending -> running pipeline run', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const run = await orchestrator.createRun(spec);

    expect(run.status).toBe('running');
    expect(run.specId).toBe('spec-1');
    expect(run.id).toBeTruthy();
  });

  it('createRun compiles spec and schedules the first step', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    await orchestrator.createRun(spec);

    expect(rm.createStepRun).toHaveBeenCalled();
    expect(rm.submitJob).toHaveBeenCalled();
  });

  it('createRun throws on invalid spec', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    await expect(orchestrator.createRun(makeSpec({ id: '' }))).rejects.toThrow('invalid spec');
  });

  it('getRun returns the created run', async () => {
    const rm = makeStubRunnerManager();
    const ais = makeStubAisSupervisor();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: ais,
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const created = await orchestrator.createRun(spec);
    const found = orchestrator.getRun(created.id);

    expect(found?.id).toBe(created.id);
    expect(found?.status).toBe('running');
  });

  it('onStepCompleted marks step as succeeded and schedules next', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [
        { id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] },
      ],
    });

    const created = await orchestrator.createRun(spec);
    const stepRunId = `${created.id}-step1-attempt-1`;

    orchestrator.onStepCompleted(stepRunId);

    const stepRun = orchestrator.getStepRuns(created.id).find((sr) => sr.id === stepRunId);
    expect(stepRun?.status).toBe('succeeded');
  });

  it('onStepFailed with retries remaining re-schedules the step', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
      retryPolicy: { maxAttempts: 3, backoffMs: 100 },
    });

    const created = await orchestrator.createRun(spec);
    const stepRunId = `${created.id}-step1-attempt-1`;

    rm.submitJob.mockClear();
    orchestrator.onStepFailed(stepRunId);

    // Should have been re-scheduled
    expect(rm.submitJob).toHaveBeenCalled();
  });

  it('onStepFailed when max retries exceeded marks step as failed and run as failed', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
      retryPolicy: { maxAttempts: 1, backoffMs: 100 },
    });

    const created = await orchestrator.createRun(spec);
    const stepRunId = `${created.id}-step1-attempt-1`;

    orchestrator.onStepFailed(stepRunId);

    const stepRun = orchestrator.getStepRuns(created.id).find((sr) => sr.id === stepRunId);
    expect(stepRun?.status).toBe('failed');

    const run = orchestrator.getRun(created.id);
    expect(run?.status).toBe('failed');
    expect(run?.riskLevel).toBe('critical');
  });

  it('cancelRun transitions run to cancelled', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const created = await orchestrator.createRun(spec);
    orchestrator.cancelRun(created.id);

    const run = orchestrator.getRun(created.id);
    expect(run?.status).toBe('cancelled');
    expect(run?.finishedAt).toBeTruthy();
  });

  it('emit routes events to rule-engine and escalates to ais-supervisor on shouldEscalate', async () => {
    const rm = makeStubRunnerManager();
    const ais = makeStubAisSupervisor();
    const actionEngine = makeStubActionEngine();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: ais,
        actionEngine,
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const created = await orchestrator.createRun(spec);

    const event = makeRuntimeEvent({
      runId: created.id,
      stepId: 'step1',
      source: 'event',
      kind: 'K8sWarningEvent',
      severity: 'error',
      message: 'Node not ready',
    });

    orchestrator.emit(event);

    // ai-supisor should have been called
    expect(ais.diagnose).toHaveBeenCalled();
  });

  it('emit does nothing when event has no runId', () => {
    const rm = makeStubRunnerManager();
    const ais = makeStubAisSupervisor();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: ais,
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const event = makeRuntimeEvent({ runId: '' });
    orchestrator.emit(event);

    expect(ais.diagnose).not.toHaveBeenCalled();
  });

  it('subscribe notifies listener on run state change', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const received: string[] = [];
    const unsub = orchestrator.subscribe((run) => received.push(run.status));

    await orchestrator.createRun(spec);

    unsub();

    expect(received.some((s) => s === 'running')).toBe(true);
  });

  it('getStepRuns returns step runs for a run', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const created = await orchestrator.createRun(spec);
    const stepRuns = orchestrator.getStepRuns(created.id);

    expect(stepRuns.length).toBeGreaterThan(0);
    expect(stepRuns[0].stepId).toBe('step1');
  });

  it('getActiveEvents returns buffered events for a run', async () => {
    const rm = makeStubRunnerManager();
    const orchestrator = new RunOrchestrator(
      { namespace: 'default' },
      {
        runnerManager: rm as any,
        aisSupervisor: makeStubAisSupervisor(),
        actionEngine: makeStubActionEngine(),
        ruleEngine: {
          evaluate: () => [{ rule: 'stuck-step', severity: 'critical', runId: '', message: 'test', evidence: [], shouldEscalate: true, timestamp: '' } as RuleResult],
          escalate: (results: RuleResult[]) => results.filter(r => r.shouldEscalate),
        },
      },
    );

    const spec = makeSpec({
      stages: [{ id: 's1', name: 'S1', steps: [{ id: 'step1', name: 'Step 1', image: 'img', commands: ['echo hi'] }] }],
    });

    const created = await orchestrator.createRun(spec);

    orchestrator.emit(makeRuntimeEvent({ runId: created.id, message: 'hello' }));

    const events = orchestrator.getActiveEvents(created.id);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('hello');
  });
});
