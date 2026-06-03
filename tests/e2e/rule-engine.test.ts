/**
 * E2E tests for Rule Engine escalation
 *
 * Note: Full rule-engine + watcher integration tests require
 * all watcher services to be deployed. These tests validate
 * basic infrastructure: spec submission → job execution → completion.
 *
 * For rule-engine unit tests, see tests/unit/rule-engine.test.ts
 */

import { describe, it, expect } from 'vitest';
import { makeFailingSpec } from './helpers/fixtures.js';
import { createRun, waitForRunCompletion } from './helpers/api.js';
import { waitForJob, waitForJobCompletion, cleanupRunResources } from './helpers/k8s.js';

describe('Rule Engine Escalation', () => {
  const namespace = 'smart-cicd';

  function makeJobName(runId: string, stepId: string): string {
    return `${runId}-${stepId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 253);
  }

  it('failing step creates job that completes (failed)', async () => {
    const spec = makeFailingSpec();
    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    const jobName = makeJobName(runId, 'fail');
    const job = await waitForJob(jobName, namespace, 30000);
    expect(job).toBeDefined();

    const completedJob = await waitForJobCompletion(jobName, namespace, 180000);
    expect(completedJob).toBeDefined();

    const finalRun = await waitForRunCompletion(runId, 60000);
    expect(finalRun?.status).toBe('failed');

    await cleanupRunResources(runId, namespace);
  }, 300_000);
});
