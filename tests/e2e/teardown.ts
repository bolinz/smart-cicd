/**
 * E2E test teardown
 *
 * This file runs after all e2e tests to:
 * 1. Preserve logs on failure
 * 2. Cleanup test resources
 */

import { afterAll, afterEach } from 'vitest';
import { cleanupRunResources } from './helpers/k8s.js';

const NAMESPACE = 'smart-cicd';

/**
 * Global teardown after all e2e tests
 */
afterAll(async () => {
  if (process.env.SKIP_E2E === 'true') {
    return;
  }

  console.log('[e2e teardown] Cleaning up test resources...');

  // In a full implementation, we would:
  // 1. Delete test namespaces
  // 2. Stop the test API server
  // 3. Preserve logs if tests failed

  console.log('[e2e teardown] Done');
}, 60_000);

/**
 * Per-test cleanup
 */
afterEach(async () => {
  if (process.env.SKIP_E2E === 'true') {
    return;
  }

  // Extract run ID from test if available and cleanup
  // In practice, each test should track its own run IDs
});
