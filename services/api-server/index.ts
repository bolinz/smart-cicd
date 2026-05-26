/**
 * API Server - E2E Test HTTP API
 *
 * Provides an HTTP API for creating and managing pipeline runs.
 * This server is used by e2e tests to interact with the RunOrchestrator.
 *
 * Endpoints:
 *   POST /runs          - Create a new pipeline run
 *   GET  /runs          - List all runs
 *   GET  /runs/:runId  - Get run details
 *   DELETE /runs/:runId - Cancel a run
 *   GET  /runs/:runId/events - SSE stream for run events
 *   GET  /health        - Health check
 */

import { createServer } from 'http';
import { KubeConfig, CoreV1Api, BatchV1Api } from '@kubernetes/client-node';
import { RunOrchestrator } from '../control-plane/orchestrator.js';
import { RunnerManager } from '../control-plane/runner-manager.js';
import { createAisSupervisor } from '../ai-supervisor/index.js';
import { createActionEngine } from '../action-engine/index.js';
import type { ActionDeps } from '../action-engine/executor.js';
import { handleRoutes } from './routes.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.SERVICE_PORT ?? '8080', 10);
const NAMESPACE = process.env.KUBERNETES_NAMESPACE ?? 'smart-cicd';

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[api-server] Starting...`);
  console.log(`[api-server] Namespace: ${NAMESPACE}`);
  console.log(`[api-server] Port: ${PORT}`);

  // Load Kubernetes config
  const kc = new KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(CoreV1Api);
  const batchApi = kc.makeApiClient(BatchV1Api);

  console.log(`[api-server] Kubernetes client initialized`);

  // Create runner manager with K8s API clients
  const runnerManager = new RunnerManager(
    { namespace: NAMESPACE },
    { k8sApi, batchApi },
  );

  // Create AI supervisor stub
  const aisSupervisor = createAisSupervisor();

  // Create action engine with K8s executor
  const actionEngineDeps: ActionDeps = {
    k8sApi,
    namespace: NAMESPACE,
    onRerunStep: (runId: string, stepId: string) => {
      orchestrator.scheduleStep(runId, stepId).catch((err: unknown) => {
        console.error('[api-server] scheduleStep failed:', err);
      });
    },
    onStopRun: (runId: string) => {
      orchestrator.cancelRun(runId);
    },
  };
  const actionEngine = createActionEngine(actionEngineDeps);

  // Create orchestrator
  const orchestrator = new RunOrchestrator(
    { namespace: NAMESPACE },
    { runnerManager, aisSupervisor, actionEngine },
  );

  console.log(`[api-server] Orchestrator initialized`);

  // Create HTTP server
  const server = createServer((req, res) => {
    handleRoutes(req, res, orchestrator);
  });

  server.listen(PORT, () => {
    console.log(`[api-server] Listening on port ${PORT}`);
    console.log(`[api-server] Endpoints:`);
    console.log(`[api-server]   POST   /runs           - Create run`);
    console.log(`[api-server]   GET    /runs           - List runs`);
    console.log(`[api-server]   GET    /runs/:id        - Get run`);
    console.log(`[api-server]   DELETE /runs/:id        - Cancel run`);
    console.log(`[api-server]   GET    /runs/:id/events - SSE events`);
    console.log(`[api-server]   GET    /health          - Health check`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[api-server] Received SIGTERM, shutting down...');
    server.close(() => {
      console.log('[api-server] Server closed');
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error('[api-server] Fatal error:', err);
  process.exit(1);
});
