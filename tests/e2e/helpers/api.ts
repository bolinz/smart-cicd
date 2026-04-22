/**
 * API helper utilities for e2e tests
 *
 * Note: The current codebase doesn't have an HTTP API for creating runs.
 * This module provides a simple HTTP server that wraps the RunOrchestrator
 * for e2e testing purposes.
 */

import type { PipelineSpec, PipelineRun, RunStatus, RiskLevel } from '../../../services/control-plane/types.js';
import type { RuntimeEvent } from '../../../services/watcher/types.js';

const DEFAULT_API_BASE = 'http://localhost:8080';

export interface RunSummary {
  id: string;
  status: RunStatus;
  riskLevel: RiskLevel;
  startedAt?: string;
  finishedAt?: string;
  stepCount: number;
  completedSteps: number;
}

export interface RunView {
  run: PipelineRun;
  currentStep?: { stepId: string; status: string };
  recentEvents: RuntimeEvent[];
  actionHistory: unknown[];
  riskLevel: RiskLevel;
}

/**
 * Create a new pipeline run by submitting a spec to the API
 */
export async function createRun(spec: PipelineSpec): Promise<PipelineRun> {
  const response = await fetch(`${DEFAULT_API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });

  if (!response.ok) {
    throw new Error(`Failed to create run: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a pipeline run by ID
 */
export async function getRun(runId: string): Promise<PipelineRun | null> {
  const response = await fetch(`${DEFAULT_API_BASE}/runs/${runId}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to get run: ${response.statusText}`);
  }

  const view: RunView = await response.json();
  return view.run;
}

/**
 * Get all runs
 */
export async function getAllRuns(): Promise<RunSummary[]> {
  const response = await fetch(`${DEFAULT_API_BASE}/runs`);

  if (!response.ok) {
    throw new Error(`Failed to get runs: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Wait for a run to complete (succeeded, failed, or cancelled)
 */
export async function waitForRunCompletion(
  runId: string,
  timeout: number = 120_000,
): Promise<PipelineRun | null> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const run = await getRun(runId);
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      return run;
    }
    await sleep(2000);
  }

  return null;
}

/**
 * Subscribe to SSE events for a run
 */
export function watchRunEvents(
  runId: string,
  onEvent: (view: RunView) => void,
  onError?: (error: Error) => void,
): () => void {
  const eventSource = new EventSource(`${DEFAULT_API_BASE}/runs/${runId}/events`);

  eventSource.onerror = () => {
    onError?.(new Error('SSE connection error'));
  };

  eventSource.addEventListener('run', (event) => {
    const view: RunView = JSON.parse(event.data);
    onEvent(view);
  });

  return () => {
    eventSource.close();
  };
}

/**
 * Wait for a specific event kind during a run
 */
export async function waitForEvent(
  runId: string,
  eventFilter: (event: RuntimeEvent) => boolean,
  timeout: number = 60000,
): Promise<RuntimeEvent | null> {
  const start = Date.now();
  let lastView: RunView | null = null;

  const unsubscribe = watchRunEvents(runId, (view) => {
    lastView = view;
  });

  try {
    while (Date.now() - start < timeout) {
      // TypeScript narrowing issue: lastView is reassigned inside an async callback
      // so we use a non-null assertion to work around it
      const view = lastView as RunView | null;
      if (view !== null) {
        const matching = view.recentEvents.filter(eventFilter);
        if (matching.length > 0) {
          return matching[matching.length - 1];
        }
      }
      await sleep(1000);
    }
  } finally {
    unsubscribe();
  }

  return null;
}

/**
 * Wait for risk level to reach a certain threshold
 */
export async function waitForRiskLevel(
  runId: string,
  minRisk: RiskLevel,
  timeout: number = 60000,
): Promise<RiskLevel | null> {
  const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  const minIndex = riskOrder.indexOf(minRisk);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const run = await getRun(runId);
    if (run) {
      const currentIndex = riskOrder.indexOf(run.riskLevel);
      if (currentIndex >= minIndex) {
        return run.riskLevel;
      }
    }
    await sleep(1000);
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
