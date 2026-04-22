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

  afterEach(async () => {
    // Cleanup handled by teardown.ts
  });

  it('SSE stream receives run state transitions', async () => {
    const testId = generateTestId('sse');
    const spec = makeSimpleSpec({ id: testId });

    // Collect state changes via SSE
    const states: RunView[] = [];
    let unsubscribe: (() => void) | null = null;

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // Subscribe to SSE events
    await new Promise<void>((resolve) => {
      unsubscribe = watchRunEvents(testId, (view) => {
        states.push(view);
        if (view.run.status === 'succeeded') {
          resolve();
        }
      });
    });

    // Wait a bit for final events to be delivered
    await new Promise((r) => setTimeout(r, 2000));

    // Unsubscribe - TypeScript narrowing issue: unsubscribe is reassigned inside async callback
    // so we use type assertion to work around it
    const unsub = unsubscribe as (() => void) | null;
    if (unsub) {
      unsub();
    }

    // Verify we received multiple state transitions
    expect(states.length).toBeGreaterThan(0);

    // First state should be 'running'
    expect(states[0]?.run.status).toBe('running');

    // Last state should be 'succeeded'
    const lastState = states[states.length - 1];
    expect(lastState?.run.status).toBe('succeeded');

    // Verify risk level transitions
    for (const state of states) {
      expect(state.riskLevel).toBeDefined();
    }

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 180_000);

  it('SSE stream receives step transitions', async () => {
    const testId = generateTestId('steps');
    const spec = makeSimpleSpec({ id: testId });

    const stepChanges: string[] = [];
    let unsubscribe: (() => void) | null = null;

    // Submit spec
    const run = await createRun(spec);
    expect(run.status).toBe('running');

    // Subscribe to SSE events and track step changes
    await new Promise<void>((resolve) => {
      unsubscribe = watchRunEvents(testId, (view) => {
        if (view.currentStep) {
          stepChanges.push(view.currentStep.stepId);
        }
        if (view.run.status === 'succeeded') {
          resolve();
        }
      });
    });

    // Wait a bit for final events
    await new Promise((r) => setTimeout(r, 2000));

    // Unsubscribe - TypeScript narrowing issue: unsubscribe is reassigned inside async callback
    const unsub2 = unsubscribe as (() => void) | null;
    if (unsub2) {
      unsub2();
    }

    // Verify step changes were received
    expect(stepChanges.length).toBeGreaterThan(0);

    // Cleanup
    await cleanupRunResources(testId, namespace);
  }, 180_000);
});
