/**
 * E2E tests for AI Supervisor diagnosis
 *
 * Note: Full AI diagnosis + action ranking requires watcher services
 * to emit events that trigger the rule-engine → ai-supervisor pipeline.
 * These tests validate basic orchestration infrastructure.
 *
 * For ai-supervisor unit tests, see tests/unit/ai-supervisor.test.ts
 */

import { describe, it, expect } from 'vitest';
import { makeSimpleSpec } from './helpers/fixtures.js';
import { createRun, waitForRunCompletion } from './helpers/api.js';
import { waitForJob, waitForJobCompletion, cleanupRunResources } from './helpers/k8s.js';

describe('AI Supervisor Diagnosis', () => {
  const namespace = 'smart-cicd';

  function makeJobName(runId: string, stepId: string): string {
    return `${runId}-${stepId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 253);
  }

  it('basic pipeline run succeeds (infrastructure test)', async () => {
    const spec = makeSimpleSpec();
    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    const jobName = makeJobName(runId, 'build');
    const job = await waitForJob(jobName, namespace, 30000);
    expect(job).toBeDefined();

    const completedJob = await waitForJobCompletion(jobName, namespace, 180000);
    expect(completedJob).toBeDefined();
    expect(completedJob?.status?.succeeded).toBe(1);

    const finalRun = await waitForRunCompletion(runId, 60000);
    expect(finalRun?.status).toBe('succeeded');

    await cleanupRunResources(runId, namespace);
  }, 300_000);
});
