/**
 * E2E tests for full pipeline run execution
 *
 * Tests the happy path:
 * 1. Submit a PipelineSpec via control-plane API
 * 2. Verify K8s Job is created
 * 3. Wait for Job to complete
 * 4. Verify run status = 'succeeded'
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeSimpleSpec, makeMultiStageSpec, generateTestId } from './helpers/fixtures.js';
import { createRun, getRun, waitForRunCompletion } from './helpers/api.js';
import { waitForJob, waitForJobCompletion, cleanupRunResources } from './helpers/k8s.js';

describe('Full Pipeline Run', () => {
  const namespace = 'smart-cicd';

  afterEach(async () => {
    // Cleanup is handled by teardown.ts
  });

  it('submit spec → schedule job → complete job → run succeeds', async () => {
    const testId = generateTestId('pipeline');
    const spec = makeSimpleSpec({ id: testId });

    // Step 1: Submit spec and get run
    const run = await createRun(spec);
    expect(run.id).toBe(testId);
    expect(run.status).toBe('running');

    // Step 2: Wait for K8s Job to be created
    // Job name is based on runId and stepId
    const jobName = `${testId}-build`.toLowerCase().slice(0, 253);
    const job = await waitForJob(jobName, namespace, 30000);
    expect(job).toBeDefined();
    expect(job?.metadata?.labels?.run_id).toBe(testId);

    // Step 3: Wait for Job to complete
    const completedJob = await waitForJobCompletion(jobName, namespace, 60000);
    expect(completedJob?.status?.succeeded).toBe(1);

    // Step 4: Verify run status
    const finalRun = await waitForRunCompletion(testId, 30000);
    expect(finalRun?.status).toBe('succeeded');

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 180_000);

  it('multi-stage pipeline executes steps in dependency order', async () => {
    const testId = generateTestId('multistage');
    const spec = makeMultiStageSpec({ id: testId });

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // First job (build) should be created immediately
    const buildJobName = `${testId}-build`.toLowerCase().slice(0, 253);
    const buildJob = await waitForJob(buildJobName, namespace, 30000);
    expect(buildJob).toBeDefined();

    // Wait for build to complete
    const completedBuild = await waitForJobCompletion(buildJobName, namespace, 60000);
    expect(completedBuild?.status?.succeeded).toBe(1);

    // Second job (test) should be created after build completes
    const testJobName = `${testId}-test`.toLowerCase().slice(0, 253);
    const testJob = await waitForJob(testJobName, namespace, 30000);
    expect(testJob).toBeDefined();

    // Wait for test to complete
    const completedTest = await waitForJobCompletion(testJobName, namespace, 60000);
    expect(completedTest?.status?.succeeded).toBe(1);

    // Verify final run status
    const finalRun = await waitForRunCompletion(testId, 30000);
    expect(finalRun?.status).toBe('succeeded');

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 300_000);

  it('run fails when step fails without retry', async () => {
    const testId = generateTestId('fail');
    const spec = makeSimpleSpec({
      id: testId,
      stages: [
        {
          id: 'fail-stage',
          name: 'Fail',
          steps: [
            {
              id: 'fail',
              name: 'Fail',
              image: 'alpine:latest',
              commands: ['exit 1'],
            },
          ],
        },
      ],
    });

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // Wait for job to fail
    const jobName = `${testId}-fail`.toLowerCase().slice(0, 253);
    const failedJob = await waitForJobCompletion(jobName, namespace, 60000);
    expect(failedJob?.status?.failed).toBe(1);

    // Verify run failed
    const finalRun = await waitForRunCompletion(testId, 30000);
    expect(finalRun?.status).toBe('failed');

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 180_000);
});
