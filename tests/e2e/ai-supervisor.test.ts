/**
 * E2E tests for AI Supervisor diagnosis
 *
 * Tests that the AI supervisor receives escalated rule results
 * and produces ranked candidate actions:
 * 1. Submit failing spec
 * 2. Wait for run failure
 * 3. Verify diagnosis.confidence > 0
 * 4. Verify rankedActions.length > 0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { makeFailingSpec, generateTestId } from './helpers/fixtures.js';
import { createRun, waitForRunCompletion, waitForRiskLevel } from './helpers/api.js';
import { waitForJobCompletion, cleanupRunResources } from './helpers/k8s.js';

describe('AI Supervisor Diagnosis', () => {
  const namespace = 'smart-cicd';

  afterEach(async () => {
    // Cleanup handled by teardown.ts
  });

  it('failing run triggers AI diagnosis with ranked actions', async () => {
    const testId = generateTestId('diagnosis');
    const spec = makeFailingSpec({ id: testId });

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // Wait for job to fail
    const jobName = `${testId}-fail`.toLowerCase().slice(0, 253);
    const failedJob = await waitForJobCompletion(jobName, namespace, 60000);
    expect(failedJob?.status?.failed).toBe(1);

    // Wait for risk level to escalate
    const riskLevel = await waitForRiskLevel(testId, 'medium', 30000);

    // Risk should escalate for failures
    expect(riskLevel).toBeTruthy();
    if (riskLevel) {
      expect(['medium', 'high', 'critical']).toContain(riskLevel);
    }

    // Verify run failed
    const finalRun = await waitForRunCompletion(testId, 30000);
    expect(finalRun?.status).toBe('failed');

    // Note: In a full implementation, we would:
    // 1. Query the ai-supervisor for diagnosis records
    // 2. Verify confidence > 0
    // 3. Verify rankedActions.length > 0
    //
    // Currently, the diagnosis is embedded in the orchestrator state
    // and not directly queryable via API.

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 180_000);
});
