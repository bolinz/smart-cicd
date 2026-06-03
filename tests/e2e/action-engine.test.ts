/**
 * E2E tests for Action Engine intervention
 *
 * Tests that interventions are executed correctly:
 * 1. Submit flake failure spec with retry policy
 * 2. First attempt fails
 * 3. rerun-step intervention is allowed
 * 4. New job is created (retry)
 * 5. Retry succeeds
 */

import { describe, it, expect, afterEach } from 'vitest';
import { makeRetryableFailureSpec, makeFailingSpec, generateTestId } from './helpers/fixtures.js';
import { createRun, waitForRunCompletion } from './helpers/api.js';
import { waitForJob, waitForJobCompletion, cleanupRunResources } from './helpers/k8s.js';

describe('Action Engine Intervention', () => {
  const namespace = 'smart-cicd';

  afterEach(async () => {
    // Cleanup handled by teardown.ts
  });

  function makeJobName(runId: string, stepId: string): string {
    return `${runId}-${stepId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 253);
  }

  it('rerun-step intervention is executed after transient failure', async () => {
    const spec = makeRetryableFailureSpec({
      retryPolicy: { maxAttempts: 3, backoffMs: 100 },
    });

    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    // Wait for first attempt to complete (retry eventually succeeds)
    const jobName = makeJobName(runId, 'flake');
    const completedJob = await waitForJobCompletion(jobName, namespace, 180000);
    expect(completedJob).toBeDefined();
    // Either succeeded (after retry) or failed with transient error

    // Verify run completes (should succeed after retry)
    const finalRun = await waitForRunCompletion(runId, 60000);
    expect(finalRun?.status).toBe('succeeded');

    await cleanupRunResources(runId, namespace);
  }, 300_000);

  it('stop-run intervention is executed for unrecoverable failures', async () => {
    const spec = makeFailingSpec();

    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    // Wait for job to fail
    const jobName = makeJobName(runId, 'fail');
    const completedJob = await waitForJobCompletion(jobName, namespace, 180000);
    expect(completedJob).toBeDefined();
    expect(completedJob?.status?.failed).toBe(1);

    // Wait for run to complete (failed or cancelled)
    const finalRun = await waitForRunCompletion(runId, 60000);
    expect(['failed', 'cancelled']).toContain(finalRun?.status);

    await cleanupRunResources(runId, namespace);
  }, 180_000);
});
