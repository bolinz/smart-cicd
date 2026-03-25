import type { BatchV1Api, KubernetesObject, Watch } from '@kubernetes/client-node';
import type { JobSignal, JobPhase } from './types';
import { normalizeJobSignal } from './normalizer';
import type { EventSink } from './event-emitter';

const DEFAULT_LABEL_KEY = 'run_id';

export interface JobWatcherConfig {
  namespace: string;
  /** Label key to filter watched jobs. Defaults to "run_id". */
  labelKey?: string;
}

export class JobWatcher {
  private readonly config: JobWatcherConfig;
  private readonly k8sApi: BatchV1Api;
  private readonly watch: Watch;
  private readonly sink: EventSink;
  private readonly labelKey: string;

  constructor(
    config: JobWatcherConfig,
    deps: {
      k8sApi: BatchV1Api;
      watch: Watch;
      sink: EventSink;
    },
  ) {
    this.config = config;
    this.k8sApi = deps.k8sApi;
    this.watch = deps.watch;
    this.sink = deps.sink;
    this.labelKey = config.labelKey ?? DEFAULT_LABEL_KEY;
  }

  /**
   * Returns true when the given job has the run_id label (or whichever
   * label key is configured). The label value is not checked — only presence.
   */
  filterByRunId(job: KubernetesObject): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = job.metadata as any;
    return Boolean(meta?.labels?.[this.labelKey]);
  }

  /**
   * Starts watching Jobs with the configured label selector and emits
   * normalized RuntimeEvents to the configured EventSink.
   *
   * Returns a function that stops the watch when called.
   */
  async start(): Promise<() => void> {
    const labelSelector = this.labelKey;

    const request = await this.watch.watch(
      `/apis/batch/v1/namespaces/${this.config.namespace}/jobs`,
      { labelSelector },
      (phase: string, obj: KubernetesObject) => {
        if (!this.filterByRunId(obj)) return;
        const signal = this.k8sToSignal(obj);
        this.sink.emit(normalizeJobSignal(signal));
      },
      (err) => {
        if (err) console.error('[JobWatcher] watch error:', err);
      },
    );

    return () => request.abort();
  }

  private k8sToSignal(obj: KubernetesObject): JobSignal {
    const o = obj as unknown as Record<string, unknown>;
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    const labels = (meta.labels ?? {}) as Record<string, string>;

    // Extract phase from job status
    const jobStatus = (o.status as Record<string, unknown> | undefined) ?? {};
    let phase: JobPhase = 'Active';

    if (jobStatus.failed !== undefined && Number(jobStatus.failed) > 0) {
      phase = 'Failed';
    } else if (jobStatus.succeeded !== undefined && Number(jobStatus.succeeded) > 0) {
      phase = 'Succeeded';
    } else if (jobStatus.active !== undefined && Number(jobStatus.active) > 0) {
      phase = 'Active';
    }

    return {
      jobName: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? this.config.namespace,
      phase,
      runId: labels[this.labelKey],
      stepId: labels['step_id'],
    };
  }
}
