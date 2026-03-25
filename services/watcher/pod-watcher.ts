import type { CoreV1Api, KubernetesObject, Watch } from '@kubernetes/client-node';
import type { PodWatcherConfig, PodSignal, PodPhase } from './types';
import { normalizePodSignal } from './normalizer';
import type { EventSink } from './event-emitter';

const DEFAULT_LABEL_KEY = 'run_id';

export class PodWatcher {
  private readonly config: PodWatcherConfig;
  private readonly k8sApi: CoreV1Api;
  private readonly watch: Watch;
  private readonly sink: EventSink;
  private readonly labelKey: string;

  /** Track the previous restart count per pod to detect increases. */
  private prevRestartCount = new Map<string, number>();

  constructor(
    config: PodWatcherConfig,
    deps: {
      k8sApi: CoreV1Api;
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
   * Returns true when the given pod has the run_id label (or whichever
   * label key is configured). The label value is not checked — only presence.
   */
  filterByRunId(pod: KubernetesObject): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = pod.metadata as any;
    return Boolean(meta?.labels?.[this.labelKey]);
  }

  /**
   * Starts watching Pods with the configured label selector and emits
   * normalized RuntimeEvents to the configured EventSink.
   *
   * Returns a function that stops the watch when called.
   */
  async start(): Promise<() => void> {
    const labelSelector = this.labelKey; // watch all pods; filterByRunId applied in handler
    const fieldSelector = `spec.nodeName!=""`;

    const request = await this.watch.watch(
      `/api/v1/namespaces/${this.config.namespace}/pods`,
      { labelSelector, fieldSelector },
      (phase: string, obj: KubernetesObject) => {
        if (!this.filterByRunId(obj)) return;
        const signal = this.k8sToSignal(obj);
        this.handleSignal(signal);
      },
      (err) => {
        if (err) console.error('[PodWatcher] watch error:', err);
      },
    );

    return () => request.abort();
  }

  private handleSignal(signal: PodSignal): void {
    const prev = this.prevRestartCount.get(signal.podName);
    const event = normalizePodSignal(signal, { prevRestartCount: prev });
    this.prevRestartCount.set(signal.podName, signal.restartCount);
    this.sink.emit(event);
  }

  private k8sToSignal(obj: KubernetesObject): PodSignal {
    // KubernetesObject is the base type; in practice the watcher returns V1Pod
    // which has spec and status. Use Record to access them safely.
    const o = obj as unknown as Record<string, unknown>;
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    const status = o.status as Record<string, unknown> | undefined;

    const labels = (meta.labels ?? {}) as Record<string, string>;
    const podStatus = status as Record<string, unknown> | undefined;
    const containerStatuses = (podStatus?.containerStatuses ?? []) as Array<Record<string, unknown>>;

    // Sum restart counts across all containers
    const restartCount = containerStatuses.reduce<number>(
      (sum, cs) => sum + ((cs.restartCount as number) ?? 0),
      0,
    );

    // Extract termination reason from the first container that has an exit state
    let reason: string | undefined;
    let message: string | undefined;
    for (const cs of containerStatuses) {
      const state = cs.state as Record<string, unknown> | undefined;
      const terminated = state?.terminated as Record<string, unknown> | undefined;
      if (terminated) {
        reason = (terminated.reason as string) ?? reason;
        message = (terminated.message as string) ?? message;
        break;
      }
    }

    return {
      podName: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? this.config.namespace,
      phase: (podStatus?.phase as PodPhase) ?? 'Unknown',
      restartCount,
      reason,
      message,
      runId: labels[this.labelKey],
      stepId: labels['step_id'],
    };
  }
}
