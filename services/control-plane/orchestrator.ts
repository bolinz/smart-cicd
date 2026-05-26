import { v4 as uuid } from 'uuid';
import type { RuntimeEvent } from '../watcher/types.js';
import type { EventSink } from '../watcher/event-emitter.js';
import type {
  PipelineSpec,
  PipelineRun,
  StepRun,
  RunGraph,
  RunStatus,
  StepStatus,
  RiskLevel,
  ActionType,
} from './types.js';
import type { RuleResult } from '../rule-engine/types.js';
import type { DiagnosisRecord } from '../ai-supervisor/types.js';
import type { CandidateAction, InterventionRecord } from '../action-engine/types.js';
import { compileSpec } from './spec-compiler.js';
import { RunnerManager } from './runner-manager.js';
import { evaluateAllRules, escalateResults } from '../rule-engine/index.js';

const DEFAULT_NAMESPACE = 'default';

/**
 * In-memory store for active runs and step runs.
 * In a production system this would be backed by a persistent store.
 */
class RunStore {
  readonly runs = new Map<string, PipelineRun>();
  readonly stepRuns = new Map<string, StepRun>();

  getRun(id: string): PipelineRun | undefined {
    return this.runs.get(id);
  }

  getStepRun(stepRunId: string): StepRun | undefined {
    return this.stepRuns.get(stepRunId);
  }

  getStepRunsForRun(runId: string): StepRun[] {
    return Array.from(this.stepRuns.values()).filter((sr) => sr.runId === runId);
  }

  saveRun(run: PipelineRun): void {
    this.runs.set(run.id, run);
  }

  saveStepRun(stepRun: StepRun): void {
    this.stepRuns.set(stepRun.id, stepRun);
  }
}

export interface AisSupervisorStub {
  diagnose(opts: {
    runId: string;
    stepId?: string;
    events: RuntimeEvent[];
    ruleResults: RuleResult[];
  }): Promise<DiagnosisRecord>;
}

export interface ActionEngineStub {
  requestIntervention(opts: {
    runId: string;
    stepId?: string;
    candidate: CandidateAction;
    diagnosisId?: string;
  }): Promise<InterventionRecord>;
}

function riskLevelFromRuleResults(results: RuleResult[]): RiskLevel {
  if (results.some((r) => r.severity === 'critical')) return 'critical';
  if (results.some((r) => r.severity === 'warning')) return 'high';
  return 'low';
}

function stepStatusFromRunStatus(status: RunStatus): StepStatus {
  switch (status) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'cancelled': return 'skipped';
    default: return 'running';
  }
}

/**
 * RunOrchestrator is the central coordinator for pipeline execution.
 *
 * Responsibilities:
 * - Create PipelineRun from PipelineSpec
 * - Compile spec to RunGraph via SpecCompiler
 * - Schedule steps as K8s Jobs via RunnerManager
 * - Wire watcher EventSink → rule-engine → ai-supervisor → action-engine
 * - Handle step completion / failure and advance PipelineRun
 * - Transition PipelineRun status: pending → running → succeeded/failed
 * - Persist run and step run state
 */
export class RunOrchestrator implements EventSink {
  private readonly store: RunStore;
  private readonly runs = new Map<string, { spec: PipelineSpec; graph: RunGraph }>();

  // Per-run event buffers for rule evaluation
  private readonly eventBuffers = new Map<string, RuntimeEvent[]>();

  // Callbacks for live-view notifications
  private readonly listeners = new Set<(run: PipelineRun) => void>();

  constructor(
    private readonly config: { namespace?: string },
    private readonly deps: {
      runnerManager: RunnerManager;
      aisSupervisor: AisSupervisorStub;
      actionEngine: ActionEngineStub;
    },
  ) {
    this.store = new RunStore();
  }

  // ─── EventSink implementation ────────────────────────────────────────────────

  /**
   * Receive normalized runtime events from watchers.
   * Routes to rule-engine, then escalates to ai-supervisor if needed.
   */
  emit(event: RuntimeEvent): void {
    if (!event.runId) return;

    const buffer = this.eventBuffers.get(event.runId) ?? [];
    buffer.push(event);
    this.eventBuffers.set(event.runId, buffer);

    this.evaluateRules(event.runId);
  }

  // ─── Rule evaluation ─────────────────────────────────────────────────────────

  private evaluateRules(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) return;

    const events = this.eventBuffers.get(runId) ?? [];
    const ctx = {
      events,
      runId,
      stepRunId: run.currentStepId,
    };

    const results = evaluateAllRules(ctx);
    if (results.length === 0) return;

    // Update risk level
    const newRisk = riskLevelFromRuleResults(results);
    if (newRisk !== run.riskLevel) {
      run.riskLevel = newRisk;
      this.store.saveRun(run);
      this.notifyListeners();
    }

    // Escalate to AI supervisor if any result has shouldEscalate
    const escalated = escalateResults(results);
    if (escalated.length > 0) {
      this.escalateToAisSupervisor(runId, run.currentStepId, events, escalated);
    }
  }

  private async escalateToAisSupervisor(
    runId: string,
    stepId: string | undefined,
    events: RuntimeEvent[],
    results: RuleResult[],
  ): Promise<void> {
    try {
      const diagnosis = await this.deps.aisSupervisor.diagnose({
        runId,
        stepId,
        events,
        ruleResults: results,
      });

      // Request interventions from action engine for ranked actions
      for (const ranked of diagnosis.rankedActions.slice(0, 3)) {
        await this.deps.actionEngine.requestIntervention({
          runId,
          stepId,
          candidate: {
            action: ranked.action,
            parameters: ranked.parameters,
            score: ranked.score,
            reason: ranked.reason,
          },
          diagnosisId: diagnosis.id,
        });
      }
    } catch (err) {
      console.error('[Orchestrator] ai-supervisor error:', err);
    }
  }

  // ─── Run lifecycle ──────────────────────────────────────────────────────────

  /**
   * Create and start a new PipelineRun from a PipelineSpec.
   */
  async createRun(spec: PipelineSpec): Promise<PipelineRun> {
    const { graph, errors } = compileSpec(spec);
    if (errors.length > 0) {
      throw new Error(`invalid spec: ${errors.join('; ')}`);
    }

    const runId = uuid();
    const run: PipelineRun = {
      id: runId,
      specId: spec.id,
      status: 'pending',
      riskLevel: 'low',
      attemptCounts: {},
    };

    this.store.saveRun(run);
    this.runs.set(runId, { spec, graph });
    this.eventBuffers.set(runId, []);

    // Initialize attempt counts for each step
    for (const step of graph.steps) {
      run.attemptCounts[step.id] = 0;
    }
    this.store.saveRun(run);

    // Start the first step(s) — those with no dependencies
    await this.scheduleReadySteps(runId);

    // Transition to running
    run.status = 'running';
    run.startedAt = new Date().toISOString();
    this.store.saveRun(run);
    this.notifyListeners();

    return run;
  }

  /**
   * Schedule all steps whose dependencies are satisfied.
   */
  private async scheduleReadySteps(runId: string): Promise<void> {
    const { graph } = this.runs.get(runId) ?? {};
    const run = this.store.getRun(runId);
    if (!graph || !run) return;

    const stepRuns = this.store.getStepRunsForRun(runId);
    const completedSteps = new Set(
      stepRuns.filter((sr) => sr.status === 'succeeded').map((sr) => sr.stepId),
    );
    const runningSteps = new Set(
      stepRuns.filter((sr) => sr.status === 'running').map((sr) => sr.stepId),
    );

    for (const graphStep of graph.steps) {
      if (completedSteps.has(graphStep.id) || runningSteps.has(graphStep.id)) {
        continue;
      }

      const deps = graph.dependencies[graphStep.id] ?? [];
      if (deps.every((dep) => completedSteps.has(dep))) {
        await this.scheduleStep(runId, graphStep.id);
      }
    }

    // Check for run completion after scheduling
    this.checkRunCompletion(runId);
  }

  public async scheduleStep(runId: string, stepId: string): Promise<void> {
    const { graph, spec } = this.runs.get(runId) ?? {};
    const run = this.store.getRun(runId);
    if (!graph || !run) return;

    const graphStep = graph.steps.find((s) => s.id === stepId);
    if (!graphStep) return;

    const attempt = (run.attemptCounts[stepId] ?? 0) + 1;
    run.attemptCounts[stepId] = attempt;
    this.store.saveRun(run);

    const stepRunId = `${runId}-${stepId}-attempt-${attempt}`;
    const stepRun: StepRun = {
      id: stepRunId,
      runId,
      stepId,
      status: 'running',
      attemptNumber: attempt,
    };
    this.store.saveStepRun(stepRun);

    run.currentStepId = stepId;
    this.store.saveRun(run);
    this.notifyListeners();

    const jobSpec = this.deps.runnerManager.createStepRun({
      run,
      step: graphStep,
      attemptNumber: attempt,
      retryPolicy: spec?.retryPolicy,
    });

    try {
      await this.deps.runnerManager.submitJob(jobSpec.jobManifest);
    } catch (err) {
      console.error(`[Orchestrator] failed to submit job for step ${stepId}:`, err);
      this.failStep(runId, stepRunId, String(err));
    }
  }

  /**
   * Called by the Job/Pod watcher when a step completes successfully.
   */
  onStepCompleted(stepRunId: string): void {
    const stepRun = this.store.getStepRun(stepRunId);
    if (!stepRun) return;

    stepRun.status = 'succeeded';
    stepRun.finishedAt = new Date().toISOString();
    this.store.saveStepRun(stepRun);

    this.scheduleReadySteps(stepRun.runId);
  }

  /**
   * Called by the Job/Pod watcher when a step fails.
   */
  onStepFailed(stepRunId: string, reason?: string): void {
    const stepRun = this.store.getStepRun(stepRunId);
    if (!stepRun) return;

    const run = this.store.getRun(stepRun.runId);
    if (!run) return;

    const { spec } = this.runs.get(stepRun.runId) ?? {};
    const maxAttempts = spec?.retryPolicy?.maxAttempts ?? 1;

    if ((run.attemptCounts[stepRun.stepId] ?? 0) < maxAttempts) {
      // Retry — re-schedule this step directly
      void this.scheduleStep(stepRun.runId, stepRun.stepId);
    } else {
      // Max retries exceeded — fail the step
      this.failStep(stepRun.runId, stepRunId, reason ?? 'max retries exceeded');
    }
  }

  private failStep(runId: string, stepRunId: string, reason: string): void {
    const stepRun = this.store.getStepRun(stepRunId);
    if (!stepRun) return;

    stepRun.status = 'failed';
    stepRun.finishedAt = new Date().toISOString();
    this.store.saveStepRun(stepRun);

    const run = this.store.getRun(runId);
    if (!run) return;

    // Fail the whole run
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    run.riskLevel = 'critical';
    this.store.saveRun(run);
    this.notifyListeners();
  }

  /**
   * Check if the run has completed (all steps succeeded or any step permanently failed).
   */
  private checkRunCompletion(runId: string): void {
    const { graph } = this.runs.get(runId) ?? {};
    const run = this.store.getRun(runId);
    if (!graph || !run) return;

    const stepRuns = this.store.getStepRunsForRun(runId);
    const completedSteps = new Set(
      stepRuns.filter((sr) => sr.status === 'succeeded' || sr.status === 'failed').map((sr) => sr.stepId),
    );
    const failedSteps = new Set(
      stepRuns.filter((sr) => sr.status === 'failed').map((sr) => sr.stepId),
    );

    if (failedSteps.size > 0) {
      // Already handled by failStep
      return;
    }

    if (completedSteps.size === graph.steps.length) {
      // All steps done — check if all succeeded
      const allSucceeded = graph.steps.every((s) => completedSteps.has(s.id));
      run.status = allSucceeded ? 'succeeded' : 'failed';
      run.finishedAt = new Date().toISOString();
      this.store.saveRun(run);
      this.notifyListeners();
    }
  }

  /**
   * Stop a run and mark it as cancelled.
   */
  cancelRun(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) return;
    run.status = 'cancelled';
    run.finishedAt = new Date().toISOString();
    this.store.saveRun(run);
    this.notifyListeners();
  }

  // ─── Live-view ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to run state changes for live-view updates.
   */
  subscribe(listener: (run: PipelineRun) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const run of this.store.runs.values()) {
      for (const listener of this.listeners) {
        listener(run);
      }
    }
  }

  getRun(runId: string): PipelineRun | undefined {
    return this.store.getRun(runId);
  }

  getStepRuns(runId: string): StepRun[] {
    return this.store.getStepRunsForRun(runId);
  }

  getActiveEvents(runId: string): RuntimeEvent[] {
    return this.eventBuffers.get(runId) ?? [];
  }

  getStepCount(runId: string): number {
    return this.runs.get(runId)?.graph.steps.length ?? 0;
  }

  getCurrentStepRun(runId: string): StepRun | undefined {
    const run = this.store.getRun(runId);
    if (!run?.currentStepId) return undefined;
    return this.store.getStepRunsForRun(runId).find((sr) => sr.stepId === run.currentStepId);
  }

  /**
   * Get all runs.
   */
  getAllRuns(): PipelineRun[] {
    return Array.from(this.store.runs.values());
  }
}
