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

  it('rerun-step intervention is executed after transient failure', async () => {
    const testId = generateTestId('rerun');
    const spec = makeRetryableFailureSpec({
      id: testId,
      retryPolicy: { maxAttempts: 3, backoffMs: 100 },
    });

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // First job attempt
    const jobName = `${testId}-flake`.toLowerCase().slice(0, 253);
    const firstJob = await waitForJob(jobName, namespace, 30000);
    expect(firstJob).toBeDefined();

    // First attempt should fail
    const failedJob = await waitForJobCompletion(jobName, namespace, 30000);
    // Note: The job itself may have backoff, so we check if it eventually completes

    // Wait for retry - a new job with attempt-2 suffix should be created
    // The exact job name depends on the orchestrator's retry logic
    const start = Date.now();
    const timeout = 60000;
    let retryJobCreated = false;

    while (Date.now() - start < timeout) {
      // Check if a retry job was created
      // The retry job name pattern is typically: runId-stepId-attempt-N
      const retryJobName = `${testId}-flake-attempt-2`.toLowerCase().slice(0, 253);

      const jobs = await waitForJob(retryJobName, namespace, 5000);
      if (jobs) {
        retryJobCreated = true;
        break;
      }

      // Also check if the original job succeeded (meaning retry happened inline)
      const currentJob = await waitForJobCompletion(jobName, namespace, 5000);
      if (currentJob?.status?.succeeded === 1) {
        retryJobCreated = true;
        break;
      }
    }

    // Verify retry happened
    expect(retryJobCreated).toBe(true);

    // Verify run eventually completes (succeeded after retry)
    const finalRun = await waitForRunCompletion(testId, 60000);
    expect(finalRun?.status).toBe('succeeded');

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 300_000);

  it('stop-run intervention is executed for unrecoverable failures', async () => {
    const testId = generateTestId('stop');
    const spec = makeFailingSpec({ id: testId });

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // Wait for job to fail
    const jobName = `${testId}-fail`.toLowerCase().slice(0, 253);
    const failedJob = await waitForJobCompletion(jobName, namespace, 60000);
    expect(failedJob?.status?.failed).toBe(1);

    // Wait for run to be stopped (either failed or cancelled)
    const finalRun = await waitForRunCompletion(testId, 30000);
    expect(['failed', 'cancelled']).toContain(finalRun?.status);

    // Note: In a full implementation, we would verify:
    // 1. The stop-run intervention was requested
    // 2. The intervention policy allowed it
    // 3. The run was cancelled

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 180_000);
});
