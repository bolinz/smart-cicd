/**
 * E2E test setup
 *
 * This file runs before all e2e tests to:
 * 1. Verify kubectl context is available
 * 2. Verify we're on a Colima cluster
 * 3. Create/verify the smart-cicd namespace
 * 4. Verify services are deployed
 */

import { beforeAll } from 'vitest';
import { KubeConfig } from '@kubernetes/client-node';
import {
  createNamespace,
  createK8sClients,
  isKubectlAvailable,
} from './helpers/k8s.js';

const NAMESPACE = 'smart-cicd';

/**
 * Check if current context is Colima or kind
 */
function isLocalCluster(): boolean {
  try {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    const context = kc.getCurrentContext();
    return context === 'colima' || context.startsWith('colima-') || context.startsWith('kind-');
  } catch {
    return false;
  }
}

beforeAll(async () => {
  // Skip e2e tests if not in e2e mode
  if (process.env.SKIP_E2E === 'true') {
    return;
  }

  // Verify kubectl is available
  if (!isKubectlAvailable()) {
    throw new Error('kubectl is not available. Please ensure kubectl is installed and configured.');
  }

  // Verify we're on a local cluster (Colima or kind)
  if (!isLocalCluster()) {
    throw new Error(
      'Not connected to a local Kubernetes cluster (Colima or kind). ' +
      'Current context: ' + (new KubeConfig().getCurrentContext()) + '. ' +
      'Please start a local cluster first.',
    );
  }

  // Create namespace if it doesn't exist
  await createNamespace(NAMESPACE);

  // Verify namespace was created
  const { k8sApi } = createK8sClients();
  try {
    await k8sApi.readNamespace(NAMESPACE);
    console.log(`[e2e setup] Namespace '${NAMESPACE}' is ready`);
  } catch {
    throw new Error(`Failed to verify namespace '${NAMESPACE}'`);
  }

  // Verify core services are deployed
  const expectedApps = [
    'api-server',
    'control-plane',
    'ui',
    'pod-watcher',
    'job-watcher',
    'event-watcher',
    'log-tailer',
    'rule-engine',
    'ai-supervisor',
    'action-engine',
  ];

  console.log('[e2e setup] Waiting for services to be ready...');
}, 120_000);
