/**
 * API Server Routes
 *
 * HTTP route handlers for the e2e test API server.
 * Provides:
 *   POST /runs          - Create a new pipeline run
 *   GET  /runs          - List all runs
 *   GET  /runs/:runId   - Get run details
 *   DELETE /runs/:runId - Cancel a run
 *   GET  /runs/:runId/events - SSE stream for run events
 *   GET  /health         - Health check
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { RunOrchestrator } from '../control-plane/orchestrator.js';
import type { PipelineSpec, PipelineRun, RunStatus, RiskLevel } from '../control-plane/types.js';
import type { RuntimeEvent } from '../watcher/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── SSE helpers ─────────────────────────────────────────────────────────────

function sendSSE(res: ServerResponse, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export function handleRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: RunOrchestrator,
): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // POST /runs - Create a new pipeline run
  if (method === 'POST' && url === '/runs') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const spec: PipelineSpec = JSON.parse(body);
        const run = await orchestrator.createRun(spec);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // GET /runs - List all runs
  if (method === 'GET' && url === '/runs') {
    const runs = orchestrator.getAllRuns();
    const summaries: RunSummary[] = [];

    for (const run of runs) {
      const stepRuns = orchestrator.getStepRuns(run.id);
      summaries.push({
        id: run.id,
        status: run.status,
        riskLevel: run.riskLevel,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        stepCount: orchestrator.getStepCount(run.id),
        completedSteps: stepRuns.filter((s) => s.status === 'succeeded').length,
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summaries));
    return;
  }

  // SSE /runs/:runId/events - Stream run events
  const eventsMatch = /^\/runs\/([^/]+)\/events$/.exec(url);
  if (method === 'GET' && eventsMatch) {
    const runId = eventsMatch[1];
    const run = orchestrator.getRun(runId);

    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Run not found' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial snapshot
    const view: RunView = buildRunView(orchestrator, runId);
    sendSSE(res, 'run', view);

    // Subscribe to updates
    const unsub = orchestrator.subscribe((updatedRun) => {
      if (updatedRun.id === runId) {
        const updatedView = buildRunView(orchestrator, runId);
        sendSSE(res, 'run', updatedView);
      }
    }, runId);

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
    return;
  }

  // GET /runs/:runId - Get run details
  const runMatch = /^\/runs\/([^/]+)$/.exec(url);
  if (method === 'GET' && runMatch) {
    const runId = runMatch[1];
    const run = orchestrator.getRun(runId);

    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Run not found' }));
      return;
    }

    const view = buildRunView(orchestrator, runId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(view));
    return;
  }

  // DELETE /runs/:runId - Cancel a run
  if (method === 'DELETE' && runMatch) {
    const runId = runMatch[1];
    const run = orchestrator.getRun(runId);

    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Run not found' }));
      return;
    }

    orchestrator.cancelRun(runId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'cancelled' }));
    return;
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildRunView(orchestrator: RunOrchestrator, runId: string): RunView {
  const run = orchestrator.getRun(runId);
  if (!run) {
    return {
      run: { id: runId, specId: '', status: 'pending', riskLevel: 'low', attemptCounts: {} },
      recentEvents: [],
      actionHistory: [],
      riskLevel: 'low',
    };
  }

  const stepRuns = orchestrator.getStepRuns(runId);
  const currentStep = stepRuns.find((s) => s.stepId === run.currentStepId);
  const events = orchestrator.getActiveEvents(runId).slice(-50);

  return {
    run,
    currentStep: currentStep ? { stepId: currentStep.stepId, status: currentStep.status } : undefined,
    recentEvents: events,
    actionHistory: [],
    riskLevel: run.riskLevel,
  };
}
