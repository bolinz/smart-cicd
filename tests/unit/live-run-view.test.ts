import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PipelineRun, RunGraph, RunStatus } from '../../services/control-plane/types.js';
import type { RuntimeEvent } from '../../services/watcher/types.js';
import { createLiveRunViewServer } from '../../services/ui/index.js';
import type { RunOrchestrator } from '../../services/control-plane/orchestrator.js';
import http from 'node:http';

// ─── Mock orchestrator ─────────────────────────────────────────────────────────

interface MockOrchestrator extends RunOrchestrator {
  _addRun(run: PipelineRun, graph: RunGraph, events?: RuntimeEvent[]): void;
  _notify(runId: string): void;
}

function makeMockOrchestrator(): MockOrchestrator {
  const runs = new Map<string, PipelineRun>();
  const stepRunsMap = new Map<string, Array<{ id: string; runId: string; stepId: string; status: RunStatus; attemptNumber: number }>>();
  const eventsMap = new Map<string, RuntimeEvent[]>();
  const graphMap = new Map<string, RunGraph>();
  const listeners = new Set<(run: PipelineRun) => void>();

  return {
    getRun(runId: string) {
      return runs.get(runId);
    },
    getStepRuns(runId: string) {
      return stepRunsMap.get(runId) ?? [];
    },
    getActiveEvents(runId: string) {
      return eventsMap.get(runId) ?? [];
    },
    getStepCount(runId: string) {
      return graphMap.get(runId)?.steps.length ?? 0;
    },
    getCurrentStepRun(runId: string) {
      const steps = stepRunsMap.get(runId) ?? [];
      const run = runs.get(runId);
      if (!run?.currentStepId) return undefined;
      return steps.find((s) => s.stepId === run.currentStepId);
    },
    subscribe(listener: (run: PipelineRun) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    _addRun(run: PipelineRun, graph: RunGraph, events: RuntimeEvent[] = []) {
      runs.set(run.id, run);
      graphMap.set(run.id, graph);
      eventsMap.set(run.id, events);
      stepRunsMap.set(run.id, [
        { id: `${run.id}-step1`, runId: run.id, stepId: 'step1', status: 'running' as RunStatus, attemptNumber: 1 },
        { id: `${run.id}-step2`, runId: run.id, stepId: 'step2', status: 'pending' as RunStatus, attemptNumber: 1 },
      ]);
    },
    _notify(runId: string) {
      const run = runs.get(runId);
      if (!run) return;
      for (const listener of listeners) listener(run);
    },
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const PORT = 14_999;

function httpGet(path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: 'localhost',
      port: PORT,
      path,
      headers: { Connection: 'close' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: text });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(); reject(new Error('timed out')); });
  });
}

function collectSSE(path: string, count = 1): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const results: unknown[] = [];
    const req = http.get({
      hostname: 'localhost',
      port: PORT,
      path,
      headers: { Connection: 'close' },
    }, (res) => {
      res.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              results.push(JSON.parse(line.slice(6)));
              if (results.length >= count) { req.destroy(); resolve(results); }
            } catch { /* ignore */ }
          }
        }
      });
      res.on('end', () => resolve(results));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(); resolve(results); });
  });
}

// ─── Test data ───────────────────────────────────────────────────────────────

const BASE_GRAPH: RunGraph = {
  specId: 'spec-1',
  steps: [
    { id: 'step1', stageId: 's1', step: { id: 'step1', name: 'Build', image: 'node:20', commands: ['npm run build'] }, eligibleActions: [] },
    { id: 'step2', stageId: 's1', step: { id: 'step2', name: 'Test', image: 'node:20', commands: ['npm test'] }, eligibleActions: [] },
  ],
  dependencies: { step2: ['step1'] },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LiveRunView', { sequential: true }, () => {
  let server: ReturnType<typeof createLiveRunViewServer>;
  let orchestrator: MockOrchestrator;

  beforeEach(() => {
    orchestrator = makeMockOrchestrator();
    server = createLiveRunViewServer(orchestrator, { port: PORT });
  });

  afterEach(() => {
    server.closeAllConnections?.();
    server.close();
  });

  // ── Health ───────────────────────────────────────────────────────────────

  it('GET /health returns 200', async () => {
    const res = await httpGet('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown path returns 404', async () => {
    const res = await httpGet('/');
    expect(res.status).toBe(404);
  });

  // ── GET /runs/:runId ────────────────────────────────────────────────────

  it('GET /runs/:runId returns 404 for unknown run', async () => {
    const res = await httpGet('/runs/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Run not found' });
  });

  it('GET /runs/:runId returns RunView for known run', async () => {
    const run: PipelineRun = {
      id: 'run-abc',
      specId: 'spec-1',
      status: 'running',
      riskLevel: 'low',
      attemptCounts: {},
      startedAt: '2026-03-27T10:00:00Z',
    };
    orchestrator._addRun(run, BASE_GRAPH);

    const res = await httpGet('/runs/run-abc');
    expect(res.status).toBe(200);
    const view = res.body as Record<string, unknown>;
    expect(view.run).toMatchObject({ id: 'run-abc', status: 'running' });
    expect(view.riskLevel).toBe('low');
  });

  it('GET /runs/:runId includes recentEvents', async () => {
    const events: RuntimeEvent[] = [{
      eventId: 'e1', runId: 'run-evt', timestamp: '2026-03-27T10:00:00Z',
      source: 'pod', kind: 'PodPhaseChanged', type: 'Running',
      severity: 'info', message: 'Pod started', labels: {}, payload: {},
    }];
    const run: PipelineRun = { id: 'run-evt', specId: 'spec-1', status: 'running', riskLevel: 'low', attemptCounts: {} };
    orchestrator._addRun(run, BASE_GRAPH, events);

    const res = await httpGet('/runs/run-evt');
    expect(res.status).toBe(200);
    const view = res.body as Record<string, unknown>;
    expect((view.recentEvents as RuntimeEvent[]).length).toBe(1);
    expect((view.recentEvents as RuntimeEvent[])[0].eventId).toBe('e1');
  });

  it('GET /runs/:runId caps recentEvents to maxRecentEvents', async () => {
    const events: RuntimeEvent[] = Array.from({ length: 5 }, (_, i) => ({
      eventId: `e${i}`, runId: 'run-limit', timestamp: new Date().toISOString(),
      source: 'pod' as const, kind: 'PodPhaseChanged' as const, type: 'Running' as const,
      severity: 'info' as const, message: `event ${i}`, labels: {}, payload: {},
    }));
    const run: PipelineRun = { id: 'run-limit', specId: 'spec-1', status: 'running', riskLevel: 'low', attemptCounts: {} };

    server.close();
    const limitedOrch = makeMockOrchestrator();
    limitedOrch._addRun(run, BASE_GRAPH, events);
    server = createLiveRunViewServer(limitedOrch, { port: PORT, maxRecentEvents: 2 });

    const res = await httpGet('/runs/run-limit');
    expect(res.status).toBe(200);
    const view = res.body as Record<string, unknown>;
    expect((view.recentEvents as RuntimeEvent[]).length).toBe(2);
  });

  // ── GET /runs ───────────────────────────────────────────────────────────

  it('GET /runs returns empty array when no clients subscribed', async () => {
    const res = await httpGet('/runs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ── SSE /runs/:runId/events ────────────────────────────────────────────

  it('GET /runs/:runId/events returns 404 for unknown run', async () => {
    const res = await httpGet('/runs/unknown/events');
    expect(res.status).toBe(404);
  });

  it('SSE endpoint sends initial run state', async () => {
    const run: PipelineRun = {
      id: 'run-sse', specId: 'spec-1', status: 'running', riskLevel: 'low', attemptCounts: {},
    };
    orchestrator._addRun(run, BASE_GRAPH);

    const results = await collectSSE('/runs/run-sse/events', 1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const first = results[0] as Record<string, unknown>;
    expect(first.run).toMatchObject({ id: 'run-sse', status: 'running' });
  });

  it('orchestrator._notify pushes updated state to SSE client', async () => {
    const run: PipelineRun = {
      id: 'run-push', specId: 'spec-1', status: 'running', riskLevel: 'low', attemptCounts: {},
    };
    orchestrator._addRun(run, BASE_GRAPH);

    const p = collectSSE('/runs/run-push/events', 2);
    // Wait for SSE connection to establish
    await new Promise((r) => setTimeout(r, 50));
    // Trigger update
    const updatedRun: PipelineRun = { ...run, riskLevel: 'high' };
    orchestrator._addRun(updatedRun, BASE_GRAPH);
    orchestrator._notify('run-push');
    const results = await p;
    const last = results[results.length - 1] as Record<string, unknown>;
    expect(last.riskLevel).toBe('high');
  });
});
