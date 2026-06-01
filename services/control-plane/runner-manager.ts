import type { BatchV1Api, CoreV1Api } from '@kubernetes/client-node';
import type { GraphStep, PipelineRun, StepRun, RetryPolicy } from './types.js';

/** Default namespace if none specified */
const DEFAULT_NAMESPACE = 'default';

export interface RunnerManagerConfig {
  namespace?: string;
  /** Service account name for runner pods. */
  serviceAccountName?: string;
  /** Image pull policy for the executor image. */
  imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
}

export interface JobSpec {
  jobName: string;
  podName: string;
  stepRunId: string;
  jobManifest: Record<string, unknown>;
}

function makeStepRunId(runId: string, stepId: string, attempt: number): string {
  return `${runId}-${stepId}-attempt-${attempt}`;
}

function makeJobName(runId: string, stepId: string): string {
  // K8s Job names must be <= 253 chars and lowercase alphanumeric + hyphens
  const sanitized = `${runId}-${stepId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return sanitized.slice(0, 253);
}

function makePodName(runId: string, stepId: string): string {
  return `${makeJobName(runId, stepId)}-pod`;
}

/**
 * Builds the command script for a step.
 * Wraps commands so that the exit code is captured properly.
 */
function buildCommand(script: string[]): string {
  // Join commands with && so exit codes propagate, then wrap in a bash -c
  const joined = script.join(' && ');
  return `set -e\n${joined}\n`;
}

/**
 * RunnerManager generates Kubernetes Job manifests for pipeline steps.
 *
 * Responsibilities:
 * - Generate K8s Job specs with run_id / step_id labels
 * - Attach retry metadata to step runs
 * - Create Pod template with the executor image and step commands
 */
export class RunnerManager {
  private readonly namespace: string;
  private readonly serviceAccountName: string;
  private readonly imagePullPolicy: string;

  constructor(
    private readonly config: RunnerManagerConfig,
    private readonly deps: {
      k8sApi: CoreV1Api;
      batchApi: BatchV1Api;
    },
  ) {
    this.namespace = config.namespace ?? DEFAULT_NAMESPACE;
    this.serviceAccountName = config.serviceAccountName ?? 'default';
    this.imagePullPolicy = config.imagePullPolicy ?? 'IfNotPresent';
  }

  /**
   * Creates a new StepRun and returns the K8s Job manifest.
   */
  createStepRun(opts: {
    run: PipelineRun;
    step: GraphStep;
    attemptNumber: number;
    retryPolicy?: RetryPolicy;
  }): JobSpec {
    const { run, step, attemptNumber } = opts;
    const stepRunId = makeStepRunId(run.id, step.id, attemptNumber);
    const jobName = makeJobName(run.id, step.id);
    const podName = makePodName(run.id, step.id);

    const jobManifest = this.buildJobManifest({
      jobName,
      podName,
      runId: run.id,
      stepId: step.id,
      stepRunId,
      attemptNumber,
      step,
      retryPolicy: opts.retryPolicy,
    });

    return { jobName, podName, stepRunId, jobManifest };
  }

  private buildJobManifest(opts: {
    jobName: string;
    podName: string;
    runId: string;
    stepId: string;
    stepRunId: string;
    attemptNumber: number;
    step: GraphStep;
    retryPolicy?: RetryPolicy;
  }): Record<string, unknown> {
    const { jobName, podName, runId, stepId, stepRunId, attemptNumber, step: graphStep } = opts;
    const { step } = graphStep;
    const script = buildCommand(step.commands);
    const backoffLimit = opts.retryPolicy?.maxAttempts ?? 0;

    // K8s Job manifest
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: this.namespace,
        labels: {
          run_id: runId,
          step_id: stepId,
          step_run_id: stepRunId,
          attempt: String(attemptNumber),
          pipeline_id: runId,
        },
      },
      spec: {
        backoffLimit,
        template: {
          metadata: {
            name: podName,
            labels: {
              run_id: runId,
              step_id: stepId,
              step_run_id: stepRunId,
              attempt: String(attemptNumber),
              pipeline_id: runId,
            },
          },
          spec: {
            restartPolicy: 'Never',
            serviceAccountName: this.serviceAccountName,
            imagePullPolicy: this.imagePullPolicy,
            containers: [
              {
                name: 'main',
                image: step.image,
                imagePullPolicy: this.imagePullPolicy,
                command: ['/bin/sh', '-c', script],
                resources: step.resourceClass
                  ? this.resourceClassToResources(step.resourceClass)
                  : undefined,
                env: [
                  { name: 'RUN_ID', value: runId },
                  { name: 'STEP_ID', value: stepId },
                  { name: 'STEP_RUN_ID', value: stepRunId },
                  { name: 'ATTEMPT', value: String(attemptNumber) },
                  { name: 'BUILDER', value: 'buildkit' }, // TODO: wire from runtime config
                ],
              },
            ],
          },
        },
      },
    };
  }

  private resourceClassToResources(resourceClass: string): Record<string, unknown> {
    // Map named resource classes to K8s resource requests/limits
    const classes: Record<string, Record<string, unknown>> = {
      small: { requests: { cpu: '250m', memory: '256Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
      medium: { requests: { cpu: '500m', memory: '512Mi' }, limits: { cpu: '1', memory: '1Gi' } },
      large: { requests: { cpu: '1', memory: '1Gi' }, limits: { cpu: '2', memory: '2Gi' } },
    };
    return classes[resourceClass] ?? {};
  }

  /**
   * Submit a Job to the cluster.
   */
  async submitJob(manifest: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.deps.batchApi.createNamespacedJob(this.namespace, manifest as any);
  }

  /**
   * Poll a K8s Job until completion, then call the callback.
   * Used when watchers are not deployed to detect step completion.
   */
  async pollJobUntilComplete(
    jobName: string,
    stepRunId: string,
    onComplete: (stepRunId: string) => void,
    onFailed: (stepRunId: string, reason: string) => void,
    timeoutMs: number = 300_000,
  ): Promise<void> {
    const start = Date.now();
    const poll = async () => {
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await this.deps.batchApi.readNamespacedJob(jobName, this.namespace);
          const job = res.body;
          if (job?.status?.succeeded === 1) {
            onComplete(stepRunId);
            return;
          }
          if (job?.status?.failed === 1) {
            const reason = job.status.conditions?.[0]?.reason ?? 'Job failed';
            onFailed(stepRunId, reason);
            return;
          }
        } catch {
          // Job might not exist yet
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      console.error(`[RunnerManager] pollJobUntilComplete timed out for job ${jobName}`);
    };
    poll();
  }
}
