/**
 * E2E tests for Live Run View SSE streaming
 *
 * Tests that the live run view correctly streams run state transitions:
 * 1. Create a run via API
 * 2. Connect SSE to /runs/:runId/events
 * 3. Collect run state changes
 * 4. Verify states: pending → running → succeeded
 */

import { describe, it, expect, afterEach } from 'vitest';
import { makeSimpleSpec, generateTestId } from './helpers/fixtures.js';
import { createRun, watchRunEvents, waitForRunCompletion } from './helpers/api.js';
import { waitForJobCompletion, cleanupRunResources } from './helpers/k8s.js';
import type { RunView } from './helpers/api.js';

describe('Live Run View', () => {
  const namespace = 'smart-cicd';

  it('SSE stream receives run state transitions', async () => {
    const spec = makeSimpleSpec();
    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    // Collect state changes via SSE
    const states: RunView[] = [];

    await new Promise<void>((resolve, reject) => {
      const unsub = watchRunEvents(runId, (view) => {
        states.push(view);
        if (view.run.status === 'succeeded' || view.run.status === 'failed') {
          unsub();
          resolve();
        }
      }, reject);

      // Safety timeout
      setTimeout(() => { unsub(); resolve(); }, 60000);
    });

    expect(states.length).toBeGreaterThan(0);
    expect(states[0]?.run.status).toBe('running');

    const lastState = states[states.length - 1];
    expect(lastState?.run.status).toBe('succeeded');

    await cleanupRunResources(runId, namespace);
  }, 120_000);

  it('SSE stream receives step transitions', async () => {
    const spec = makeSimpleSpec();
    const run = await createRun(spec);
    expect(run.status).toBe('running');
    const runId = run.id;

    const stepChanges: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const unsub = watchRunEvents(runId, (view) => {
        if (view.currentStep) {
          stepChanges.push(view.currentStep.stepId);
        }
        if (view.run.status === 'succeeded') {
          unsub();
          resolve();
        }
      }, reject);

      setTimeout(() => { unsub(); resolve(); }, 60000);
    });

    expect(stepChanges.length).toBeGreaterThan(0);

    await cleanupRunResources(runId, namespace);
  }, 120_000);
});
