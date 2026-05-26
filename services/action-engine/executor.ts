// Executes approved interventions

import type { CoreV1Api } from '@kubernetes/client-node';
import type { InterventionRecord, CandidateAction, ActionResult } from './types.js';
import type { PipelineRun } from '../control-plane/types.js';

export interface ActionDeps {
  k8sApi: CoreV1Api;
  namespace: string;
  // Callback to the orchestrator to reschedule a step
  onRerunStep?: (runId: string, stepId: string) => void;
  // Callback to the orchestrator to cancel a run
  onStopRun?: (runId: string) => void;
}

export class InterventionExecutor {
  constructor(private readonly deps: ActionDeps) {}

  async executeAction(
    action: CandidateAction,
    run: PipelineRun,
    record: InterventionRecord,
  ): Promise<ActionResult> {
    switch (action.action) {
      case 'rerun-step':
        return this.executeRerunStep(run, record);
      case 'stop-run':
        return this.executeStopRun(run, record);
      case 'restart-runner-pod':
        return this.executeRestartRunnerPod(run, record);
      case 'clear-cache-and-rerun':
        return this.executeClearCacheAndRerun(run, record);
      default:
        return { success: false, message: `Unknown action: ${action.action}` };
    }
  }

  private async executeRerunStep(
    run: PipelineRun,
    record: InterventionRecord,
  ): Promise<ActionResult> {
    const stepId = record.stepId ?? run.currentStepId;
    if (!stepId) {
      return { success: false, message: 'No stepId available for rerun' };
    }

    if (this.deps.onRerunStep) {
      this.deps.onRerunStep(run.id, stepId);
      return {
        success: true,
        message: `Rerun step ${stepId} requested`,
        effects: { stepId, runId: run.id },
      };
    }

    return { success: false, message: 'Rerun callback not configured' };
  }

  private async executeStopRun(
    run: PipelineRun,
    record: InterventionRecord,
  ): Promise<ActionResult> {
    if (this.deps.onStopRun) {
      this.deps.onStopRun(run.id);
      return {
        success: true,
        message: `Run ${run.id} stop requested`,
        effects: { runId: run.id },
      };
    }

    return { success: false, message: 'Stop callback not configured' };
  }

  private async executeRestartRunnerPod(
    run: PipelineRun,
    record: InterventionRecord,
  ): Promise<ActionResult> {
    const stepId = record.stepId ?? run.currentStepId;
    if (!stepId) {
      return { success: false, message: 'No stepId available for pod restart' };
    }

    const podName = `runner-${run.id}-${stepId}`;

    try {
      // Delete the runner pod to trigger a restart
      await this.deps.k8sApi.deleteNamespacedPod(podName, this.deps.namespace);
      return {
        success: true,
        message: `Pod ${podName} deleted for restart`,
        effects: { podName, runId: run.id, stepId },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to delete pod: ${message}` };
    }
  }

  private async executeClearCacheAndRerun(
    run: PipelineRun,
    record: InterventionRecord,
  ): Promise<ActionResult> {
    const stepId = record.stepId ?? run.currentStepId;
    if (!stepId) {
      return { success: false, message: 'No stepId available for cache clear and rerun' };
    }

    if (this.deps.onRerunStep) {
      // Pass stepId with cache clear flag
      this.deps.onRerunStep(run.id, stepId);
      return {
        success: true,
        message: `Cache clear and rerun step ${stepId} requested`,
        effects: { stepId, runId: run.id, cacheCleared: true },
      };
    }

    return { success: false, message: 'Rerun callback not configured' };
  }
}
