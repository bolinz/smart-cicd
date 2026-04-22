/**
 * Kubernetes helper utilities for e2e tests
 */

import { KubeConfig, CoreV1Api, BatchV1Api } from '@kubernetes/client-node';
import type { V1Job, V1Pod } from '@kubernetes/client-node';

const DEFAULT_NAMESPACE = 'smart-cicd';
const DEFAULT_TIMEOUT = 60_000;

/**
 * Create Kubernetes API clients configured for the current context
 */
export function createK8sClients(): { k8sApi: CoreV1Api; batchApi: BatchV1Api } {
  const kc = new KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(CoreV1Api);
  const batchApi = kc.makeApiClient(BatchV1Api);

  return { k8sApi, batchApi };
}

/**
 * Wait for a Kubernetes Job to exist
 */
export async function waitForJob(
  jobName: string,
  namespace: string = DEFAULT_NAMESPACE,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<V1Job | null> {
  const { batchApi } = createK8sClients();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await batchApi.readNamespacedJob(jobName, namespace);
      if (response.body) {
        return response.body;
      }
    } catch {
      // Job doesn't exist yet
    }
    await sleep(1000);
  }

  return null;
}

/**
 * Wait for a Kubernetes Job to complete (Succeeded or Failed)
 */
export async function waitForJobCompletion(
  jobName: string,
  namespace: string = DEFAULT_NAMESPACE,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<V1Job | null> {
  const { batchApi } = createK8sClients();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await batchApi.readNamespacedJob(jobName, namespace);
      const job = response.body;

      if (job?.status?.succeeded === 1) {
        return job;
      }
      if (job?.status?.failed === 1) {
        return job;
      }
    } catch {
      // Job doesn't exist yet
    }
    await sleep(1000);
  }

  return null;
}

/**
 * Wait for a pod to exist
 */
export async function waitForPod(
  podName: string,
  namespace: string = DEFAULT_NAMESPACE,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<V1Pod | null> {
  const { k8sApi } = createK8sClients();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await k8sApi.readNamespacedPod(podName, namespace);
      if (response.body) {
        return response.body;
      }
    } catch {
      // Pod doesn't exist yet
    }
    await sleep(1000);
  }

  return null;
}

/**
 * Wait for pod to be in a specific phase
 */
export async function waitForPodPhase(
  podName: string,
  phase: string,
  namespace: string = DEFAULT_NAMESPACE,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<V1Pod | null> {
  const { k8sApi } = createK8sClients();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await k8sApi.readNamespacedPod(podName, namespace);
      const pod = response.body;

      if (pod?.status?.phase === phase) {
        return pod;
      }
    } catch {
      // Pod doesn't exist yet
    }
    await sleep(1000);
  }

  return null;
}

/**
 * Get pod logs
 */
export async function getPodLogs(
  podName: string,
  namespace: string = DEFAULT_NAMESPACE,
  containerName?: string,
): Promise<string> {
  const { k8sApi } = createK8sClients();

  try {
    const response = await k8sApi.readNamespacedPodLog(
      podName,
      namespace,
      containerName,
    );
    return response.body as string;
  } catch {
    return '';
  }
}

/**
 * Delete all resources for a given run in the namespace
 */
export async function cleanupRunResources(
  runId: string,
  namespace: string = DEFAULT_NAMESPACE,
): Promise<void> {
  const { k8sApi, batchApi } = createK8sClients();

  // Delete jobs with run_id label
  try {
    const jobsResponse = await batchApi.listNamespacedJob(namespace);
    const jobs = jobsResponse.body.items.filter(
      (job) => job.metadata?.labels?.run_id === runId,
    );

    for (const job of jobs) {
      if (job.metadata?.name) {
        await batchApi.deleteNamespacedJob(job.metadata.name, namespace);
      }
    }
  } catch {
    // Ignore errors
  }

  // Delete pods with run_id label
  try {
    const podsResponse = await k8sApi.listNamespacedPod(namespace);
    const pods = podsResponse.body.items.filter(
      (pod) => pod.metadata?.labels?.run_id === runId,
    );

    for (const pod of pods) {
      if (pod.metadata?.name) {
        await k8sApi.deleteNamespacedPod(pod.metadata.name, namespace);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Create a namespace
 */
export async function createNamespace(namespace: string): Promise<void> {
  const { k8sApi } = createK8sClients();

  try {
    await k8sApi.createNamespace({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace },
    });
  } catch {
    // Namespace may already exist
  }
}

/**
 * Delete a namespace
 */
export async function deleteNamespace(namespace: string): Promise<void> {
  const { k8sApi } = createK8sClients();

  try {
    await k8sApi.deleteNamespace(namespace);
  } catch {
    // Namespace may not exist
  }
}

/**
 * Wait for namespace to be deleted
 */
export async function waitForNamespaceDeletion(
  namespace: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<boolean> {
  const { k8sApi } = createK8sClients();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      await k8sApi.readNamespace(namespace);
    } catch {
      // Namespace no longer exists
      return true;
    }
    await sleep(1000);
  }

  return false;
}

/**
 * Get all pods in namespace with run_id label
 */
export async function getPodsByRunId(
  runId: string,
  namespace: string = DEFAULT_NAMESPACE,
): Promise<V1Pod[]> {
  const { k8sApi } = createK8sClients();

  try {
    const response = await k8sApi.listNamespacedPod(namespace);
    return response.body.items.filter(
      (pod) => pod.metadata?.labels?.run_id === runId,
    );
  } catch {
    return [];
  }
}

/**
 * Check if kubectl context is available and valid
 */
export function isKubectlAvailable(): boolean {
  try {
    const { k8sApi } = createK8sClients();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
