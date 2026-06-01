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

  function makeJobName(runId: string, stepId: string): string {
    return `${runId}-${stepId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 253);
  }

  it('submit spec → schedule job → complete job → run succeeds', async () => {
    const spec = makeSimpleSpec();

    // Step 1: Submit spec and get run
    const run = await createRun(spec);
    expect(run.id).toBeTruthy();
    expect(run.status).toBe('running');
    const runId = run.id;

    // Step 2: Wait for K8s Job to be created
    const jobName = makeJobName(runId, 'build');
    const job = await waitForJob(jobName, namespace, 30000);
    expect(job).toBeDefined();
    expect(job?.metadata?.labels?.run_id).toBe(runId);

    // Step 3: Wait for Job to complete
    const completedJob = await waitForJobCompletion(jobName, namespace, 60000);
    expect(completedJob?.status?.succeeded).toBe(1);

    // Step 4: Verify run status
    const finalRun = await waitForRunCompletion(runId, 30000);
    expect(finalRun?.status).toBe('succeeded');

    // Cleanup
    await cleanupRunResources(runId, namespace);
  }, 180_000);

  it('multi-stage pipeline executes steps in dependency order', async () => {
    const spec = makeMultiStageSpec();

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    // First job (build) should be created immediately
    const buildJobName = makeJobName(runId, 'build');
    const buildJob = await waitForJob(buildJobName, namespace, 30000);
    expect(buildJob).toBeDefined();

    // Wait for build to complete
    const completedBuild = await waitForJobCompletion(buildJobName, namespace, 60000);
    expect(completedBuild?.status?.succeeded).toBe(1);

    // Second job (test) should be created after build completes
    const testJobName = makeJobName(runId, 'test');
    const testJob = await waitForJob(testJobName, namespace, 30000);
    expect(testJob).toBeDefined();

    // Wait for test to complete
    const completedTest = await waitForJobCompletion(testJobName, namespace, 60000);
    expect(completedTest?.status?.succeeded).toBe(1);

    // Verify final run status
    const finalRun = await waitForRunCompletion(runId, 30000);
    expect(finalRun?.status).toBe('succeeded');

    // Cleanup
    await cleanupRunResources(runId, namespace);
  }, 300_000);

  it('run fails when step fails without retry', async () => {
    const spec = makeSimpleSpec({
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
    const runId = run.id;

    // Wait for job to fail
    const jobName = makeJobName(runId, 'fail');
    const failedJob = await waitForJobCompletion(jobName, namespace, 60000);
    expect(failedJob?.status?.failed).toBe(1);

    // Verify run failed
    const finalRun = await waitForRunCompletion(runId, 30000);
    expect(finalRun?.status).toBe('failed');

    // Cleanup
    await cleanupRunResources(runId, namespace);
  }, 180_000);
});
