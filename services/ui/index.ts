// Live Run View — SSE backend
//
// Exposes run state via HTTP + Server-Sent Events so a UI client can subscribe
// to real-time run updates without polling.

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import type { RunOrchestrator } from '../control-plane/orchestrator.js';
import type { PipelineRun, RunGraph } from '../control-plane/types.js';
import type { RuntimeEvent } from '../watcher/types.js';
import type { RunView, RunSummary } from './types.js';

export { type RunView, type RunSummary };

// ─── Config ──────────────────────────────────────────────────────────────────

export interface LiveRunViewConfig {
  /** TCP port to listen on. Defaults to 8080. */
  port?: number;
  /** Maximum events to include in recentEvents. Defaults to 50. */
  maxRecentEvents?: number;
}

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Creates an HTTP server that exposes run state over SSE.
 *
 * Wired to the RunOrchestrator so that every run state transition
 * (start, step change, risk change, completion) is pushed to subscribed clients.
 *
 * Endpoints:
 *   GET /runs              → RunSummary[]
 *   GET /runs/:runId       → RunView
 *   GET /runs/:runId/events → text/event-stream (SSE)
 *
 * Health check:
 *   GET /health            → 200 OK
 */
export function createLiveRunViewServer(
  orchestrator: RunOrchestrator,
  config: LiveRunViewConfig = {},
): Server {
  const { port = 8080, maxRecentEvents = 50 } = config;

  // SSE client connections keyed by runId.
  // Each entry is a Set of ServerResponse objects.
  const clientsByRun = new Map<string, Set<ServerResponse>>();

  function sendSSE(res: ServerResponse, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Client disconnected — will be cleaned up by close handler
    }
  }

  function broadcast(runId: string, event: string, data: unknown): void {
    const runClients = clientsByRun.get(runId);
    if (runClients) {
      for (const res of runClients) {
        sendSSE(res, event, data);
      }
    }
  }

  function buildRunView(runId: string): RunView | undefined {
    const run = orchestrator.getRun(runId);
    if (!run) return undefined;

    const stepRuns = orchestrator.getStepRuns(runId);
    const currentStep = stepRuns.find((s) => s.stepId === run.currentStepId);
    const events = orchestrator.getActiveEvents(runId).slice(-maxRecentEvents);

    // TODO: wire InterventionStore from action-engine to populate actionHistory
    // TODO: wire DiagnosisRecord from ai-supervisor to populate currentDiagnosis
    return {
      run,
      currentStep,
      recentEvents: events,
      actionHistory: [],
      riskLevel: run.riskLevel,
    };
  }

  // Subscribe to orchestrator state transitions and broadcast to relevant SSE clients
  const unsub = orchestrator.subscribe((run: PipelineRun) => {
    broadcast(run.id, 'run', buildRunView(run.id));
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for browser clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    const pathname = req.url ?? '/';

    // Health check
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // List all active runs
    if (pathname === '/runs') {
      const runIds = Array.from(clientsByRun.keys());
      const summaries: RunSummary[] = [];
      for (const runId of runIds) {
        const run = orchestrator.getRun(runId);
        if (run) {
          const stepRuns = orchestrator.getStepRuns(runId);
          summaries.push({
            id: run.id,
            status: run.status,
            riskLevel: run.riskLevel,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            stepCount: orchestrator.getStepCount(runId),
            completedSteps: stepRuns.filter((s) => s.status === 'succeeded').length,
          });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summaries));
      return;
    }

    // GET /runs/:runId/events
    const eventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname);
    if (eventsMatch) {
      const runId = eventsMatch[1];
      if (!orchestrator.getRun(runId)) {
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
      const initialView = buildRunView(runId);
      if (initialView) {
        sendSSE(res, 'run', initialView);
      }

      // Register this client
      let runClients = clientsByRun.get(runId);
      if (!runClients) {
        runClients = new Set();
        clientsByRun.set(runId, runClients);
      }
      runClients.add(res);

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
        runClients?.delete(res);
        if (runClients?.size === 0) {
          clientsByRun.delete(runId);
        }
      });
      return;
    }

    // GET /runs/:runId
    const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
    if (runMatch) {
      const runId = runMatch[1];
      const view = buildRunView(runId);
      if (!view) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Run not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(view));
      return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => {
    console.log(`[LiveRunView] listening on port ${port}`);
  });

  server.on('close', () => {
    unsub();
    clientsByRun.clear();
  });

  return server;
}
