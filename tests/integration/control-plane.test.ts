// Integration tests for the control-plane — full orchestrator loop
//
// Tests the complete execution path:
//   PipelineSpec → RunGraph → PipelineRun → step scheduling →
//   step completion → run completion
//
// Also tests:
//   - Rule-engine escalation and AI supervisor diagnosis
//   - Action-engine intervention execution
//   - Step failure and retry
//   - Run cancellation

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PipelineSpec, PipelineRun, ActionType } from '../../services/control-plane/types.js';
import { RunOrchestrator } from '../../services/control-plane/orchestrator.js';
import { createAisSupervisor } from '../../services/ai-supervisor/index.js';
import type { AisSupervisorStub } from '../../services/control-plane/orchestrator.js';
import type { ActionEngineStub } from '../../services/control-plane/orchestrator.js';
import type { RuntimeEvent } from '../../services/watcher/types.js';

// ─── Mock Kubernetes API ───────────────────────────────────────────────────────

/** Records all submitted job manifests and allows simulating completion. */
class MockRunnerManager {
  readonly submittedJobs: Array<{ manifest: Record<string, unknown>; stepRunId: string }> = [];
  private stepRunIdToJob = new Map<string, string>();

  createStepRun(opts: {
    run: { id: string };
    step: { id: string };
    attemptNumber: number;
    retryPolicy?: { maxAttempts: number };
  }): { jobManifest: Record<string, unknown>; jobName: string; podName: string; stepRunId: string } {
    const stepRunId = `${opts.run.id}-${opts.step.id}-attempt-${opts.attemptNumber}`;
    const jobName = `${opts.run.id}-${opts.step.id}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 253);
    const manifest = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: 'default',
        labels: {
          run_id: opts.run.id,
          step_id: opts.step.id,
          step_run_id: stepRunId,
          attempt: String(opts.attemptNumber),
        },
      },
      spec: {
        backoffLimit: opts.retryPolicy?.maxAttempts ?? 0,
        template: {
          metadata: { labels: { run_id: opts.run.id, step_id: opts.step.id } },
          spec: {
            restartPolicy: 'Never',
            containers: [{ name: 'main', image: 'node:20', command: ['echo', 'hello'] }],
          },
        },
      },
    };
    this.submittedJobs.push({ manifest, stepRunId });
    this.stepRunIdToJob.set(stepRunId, jobName);
    return { jobManifest: manifest, jobName, podName: `${jobName}-pod`, stepRunId };
  }

  async submitJob(manifest: Record<string, unknown>): Promise<void> {
    // no-op: job is "submitted" via createStepRun
  }

  /** Look up stepRunId from a submitted job by index */
  getStepRunId(index: number): string {
    return this.submittedJobs[index]?.stepRunId ?? '';
  }
}

// ─── Mock AI Supervisor ───────────────────────────────────────────────────────

function makeMockAisSupervisor(): AisSupervisorStub {
  return createAisSupervisor();
}

// ─── Mock Action Engine ───────────────────────────────────────────────────────

class MockActionEngine implements ActionEngineStub {
  readonly interventionRecords: Array<{
    runId: string;
    stepId?: string;
    candidate: { action: string; score: number };
    diagnosisId?: string;
  }> = [];

  async requestIntervention(opts: {
    runId: string;
    stepId?: string;
    candidate: { action: string; score: number; reason: string; parameters?: Record<string, unknown> };
    diagnosisId?: string;
  }) {
    this.interventionRecords.push(opts);
    return {
      id: `ir-${this.interventionRecords.length}`,
      runId: opts.runId,
      stepId: opts.stepId,
      actionType: opts.candidate.action as ActionType,
      actionParameters: opts.candidate.parameters ?? {},
      policyDecision: 'allowed' as const,
      triggerReason: opts.candidate.reason,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const SIMPLE_SPEC: PipelineSpec = {
  id: 'test-pipeline',
  sourceRepo: 'https://github.com/test/repo',
  ref: 'main',
  stages: [
    {
      id: 'build-stage',
      name: 'Build',
      steps: [
        { id: 'build', name: 'Build', image: 'node:20', commands: ['npm run build'] },
      ],
    },
    {
      id: 'test-stage',
      name: 'Test',
      dependsOn: ['build-stage'],
      steps: [
        { id: 'test', name: 'Test', image: 'node:20', commands: ['npm test'] },
      ],
    },
  ],
  runtime: { builder: 'docker', executorImage: 'smart-cicd/executor:latest' },
};

function makeOrchestrator(
  runnerManager: MockRunnerManager,
  aisSupervisor: AisSupervisorStub,
  actionEngine: MockActionEngine,
) {
  return new RunOrchestrator(
    { namespace: 'default' },
    {
      runnerManager: runnerManager as unknown as import('../../services/control-plane/runner-manager.js').RunnerManager,
      aisSupervisor,
      actionEngine,
    },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RunOrchestrator — integration', () => {

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('submitSpec → schedule first step → complete step → complete run', async () => {
    const runnerManager = new MockRunnerManager();
    const mockAis = makeMockAisSupervisor();
    const mockAction = new MockActionEngine();
    const orchestrator = makeOrchestrator(runnerManager, mockAis, mockAction);

    const run = await orchestrator.createRun(SIMPLE_SPEC);

    // Run is created and first step is scheduled
    expect(run.status).toBe('running');
    expect(run.specId).toBe('test-pipeline');
    expect(run.riskLevel).toBe('low');
    expect(run.startedAt).toBeDefined();

    // One job submitted (build step has no dependencies)
    expect(runnerManager.submittedJobs).toHaveLength(1);
    const buildStepRunId = runnerManager.getStepRunId(0);

    // Complete the build step
    orchestrator.onStepCompleted(buildStepRunId);

    // Second step (test) should now be scheduled
    expect(runnerManager.submittedJobs).toHaveLength(2);
    const testStepRunId = runnerManager.getStepRunId(1);

    // Complete the test step
    orchestrator.onStepCompleted(testStepRunId);

    // Run should be complete
    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun!.status).toBe('succeeded');
    expect(finalRun!.finishedAt).toBeDefined();
  });

  it('live-view subscribers receive notifications on state transitions', async () => {
    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const states: PipelineRun[] = [];
    const unsub = orchestrator.subscribe((run) => states.push({ ...run }));

    const run = await orchestrator.createRun(SIMPLE_SPEC);
    const buildStepRunId = runnerManager.getStepRunId(0);
    orchestrator.onStepCompleted(buildStepRunId);
    const testStepRunId = runnerManager.getStepRunId(1);
    orchestrator.onStepCompleted(testStepRunId);

    unsub();

    // Should have notifications for: run created (running), step change, each completion
    expect(states.length).toBeGreaterThanOrEqual(3);

    // Last state should be succeeded
    const last = states[states.length - 1];
    expect(last.status).toBe('succeeded');
  });

  // ── Retry on step failure ───────────────────────────────────────────────────

  it('step failure triggers retry up to maxAttempts', async () => {
    const specWithRetry: PipelineSpec = {
      ...SIMPLE_SPEC,
      retryPolicy: { maxAttempts: 3, backoffMs: 100 },
    };

    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const run = await orchestrator.createRun(specWithRetry);
    const buildStepRunId = runnerManager.getStepRunId(0);

    // Fail once
    orchestrator.onStepFailed(buildStepRunId, 'transient error');

    // Should retry (new job submitted, same step)
    expect(runnerManager.submittedJobs).toHaveLength(2);
    expect(runnerManager.getStepRunId(1)).toBe(`${run.id}-build-attempt-2`);

    // Fail again
    orchestrator.onStepFailed(runnerManager.getStepRunId(1), 'still failing');

    // Third attempt
    expect(runnerManager.submittedJobs).toHaveLength(3);
    expect(runnerManager.getStepRunId(2)).toBe(`${run.id}-build-attempt-3`);

    // Fail third time — max retries exceeded, step should be failed
    orchestrator.onStepFailed(runnerManager.getStepRunId(2), 'persistent failure');

    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun!.status).toBe('failed');
    expect(finalRun!.finishedAt).toBeDefined();
  });

  // ── Cancellation ───────────────────────────────────────────────────────────

  it('cancelRun transitions run to cancelled', async () => {
    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const run = await orchestrator.createRun(SIMPLE_SPEC);
    expect(orchestrator.getRun(run.id)!.status).toBe('running');

    orchestrator.cancelRun(run.id);

    const cancelled = orchestrator.getRun(run.id)!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.finishedAt).toBeDefined();
  });

  // ── Rule escalation and AI supervisor ──────────────────────────────────────

  it('events trigger rule evaluation → escalation → AI supervisor diagnosis', async () => {
    const runnerManager = new MockRunnerManager();
    const mockAis = makeMockAisSupervisor();
    const mockAction = new MockActionEngine();
    const orchestrator = makeOrchestrator(runnerManager, mockAis, mockAction);

    const run = await orchestrator.createRun(SIMPLE_SPEC);

    // Emit events that trigger infra-failure rule (PodTerminated with OOMKilled).
    // The infraFailureRule fires when source='pod' && kind='PodTerminated' and
    // payload.reason includes 'OOMKilled'.
    orchestrator.emit({
      eventId: 'evt-oom',
      runId: run.id,
      timestamp: new Date().toISOString(),
      source: 'pod',
      kind: 'PodTerminated',
      type: 'Failed',
      severity: 'error' as const,
      message: 'Container node:20 was OOMKilled: memory limit exceeded',
      labels: { namespace: 'default' },
      payload: { reason: 'OOMKilled', phase: 'Failed', message: 'memory limit exceeded' },
    });

    // Allow async escalation to complete
    await new Promise((r) => setTimeout(r, 50));

    // The AI supervisor should have been called (intervention requested)
    expect(mockAction.interventionRecords.length).toBeGreaterThan(0);
    const intervention = mockAction.interventionRecords[0];
    expect(intervention.runId).toBe(run.id);
    expect(intervention.candidate.action).toBeTruthy();
  });

  it('critical rule results escalate to ai-supervisor and update risk level', async () => {
    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const run = await orchestrator.createRun(SIMPLE_SPEC);

    // Emit an infra-failure event (OOMKilled)
    orchestrator.emit({
      eventId: 'evt-oom',
      runId: run.id,
      timestamp: new Date().toISOString(),
      source: 'pod',
      kind: 'PodTerminated',
      type: 'Failed',
      severity: 'error' as const,
      message: 'Container was OOMKilled',
      labels: { namespace: 'default' },
      payload: { reason: 'OOMKilled', phase: 'Failed' },
    });

    await new Promise((r) => setTimeout(r, 50));

    const finalRun = orchestrator.getRun(run.id);
    expect(finalRun!.riskLevel).toBe('critical');
  });

  // ── Step ordering ──────────────────────────────────────────────────────────

  it('steps execute in dependency order', async () => {
    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const run = await orchestrator.createRun(SIMPLE_SPEC);

    // Only build step submitted initially (test depends on build)
    expect(runnerManager.submittedJobs).toHaveLength(1);
    expect(run.currentStepId).toBe('build');

    // Complete build
    orchestrator.onStepCompleted(runnerManager.getStepRunId(0));

    // Now test is scheduled
    expect(runnerManager.submittedJobs).toHaveLength(2);
    expect(orchestrator.getRun(run.id)!.currentStepId).toBe('test');
  });

  // ── Event buffering ────────────────────────────────────────────────────────

  it('events are buffered per run and retrievable via getActiveEvents', async () => {
    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const run = await orchestrator.createRun(SIMPLE_SPEC);

    orchestrator.emit({
      eventId: 'evt-a',
      runId: run.id,
      timestamp: new Date().toISOString(),
      source: 'pod',
      kind: 'PodPhaseChanged',
      type: 'Running',
      severity: 'info' as const,
      message: 'running',
      labels: { namespace: 'default' },
      payload: {},
    });

    orchestrator.emit({
      eventId: 'evt-b',
      runId: run.id,
      timestamp: new Date().toISOString(),
      source: 'job',
      kind: 'JobPhaseChanged',
      type: 'Active',
      severity: 'debug' as const,
      message: 'job active',
      labels: { namespace: 'default' },
      payload: {},
    });

    const events = orchestrator.getActiveEvents(run.id);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.eventId)).toContain('evt-a');
    expect(events.map((e) => e.eventId)).toContain('evt-b');
  });

  it('events from other runs are isolated', async () => {
    const runnerManager = new MockRunnerManager();
    const orchestrator = makeOrchestrator(runnerManager, makeMockAisSupervisor(), new MockActionEngine());

    const [run1, run2] = await Promise.all([
      orchestrator.createRun(SIMPLE_SPEC),
      orchestrator.createRun(SIMPLE_SPEC),
    ]);

    orchestrator.emit({
      eventId: 'evt-run1-only',
      runId: run1.id,
      timestamp: new Date().toISOString(),
      source: 'pod',
      kind: 'PodPhaseChanged',
      type: 'Running',
      severity: 'info' as const,
      message: 'run1 event',
      labels: { namespace: 'default' },
      payload: {},
    });

    expect(orchestrator.getActiveEvents(run1.id)).toHaveLength(1);
    expect(orchestrator.getActiveEvents(run2.id)).toHaveLength(0);
  });
});
