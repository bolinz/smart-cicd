import type { CoreV1Api, KubernetesObject, Watch } from '@kubernetes/client-node';
import type { K8sEventSignal } from './types';
import { normalizeK8sEventSignal } from './normalizer';
import type { EventSink } from './event-emitter';

const DEFAULT_LABEL_KEY = 'run_id';

export interface EventWatcherConfig {
  namespace: string;
  /** Label key to filter watched resources. Defaults to "run_id". */
  labelKey?: string;
}

/**
 * EventWatcher observes Kubernetes events within a namespace and emits
 * normalized RuntimeEvents for events whose involved objects carry the
 * configured run_id label (or label key).
 */
export class EventWatcher {
  private readonly config: EventWatcherConfig;
  private readonly k8sApi: CoreV1Api;
  private readonly watch: Watch;
  private readonly sink: EventSink;
  private readonly labelKey: string;

  constructor(
    config: EventWatcherConfig,
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
   * Returns true when the involved object of the given event carries the
   * run_id label (or whichever label key is configured).
   *
   * Kubernetes events expose the involved object's labels under
   * involvedObject.metadata.labels, not on the event's own metadata.
   */
  filterByRunId(obj: KubernetesObject): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = obj as unknown as Record<string, unknown>;
    const involvedObject = (o.involvedObject ?? {}) as Record<string, unknown>;
    const involvedMeta = (involvedObject.metadata ?? {}) as Record<string, unknown>;
    const labels = (involvedMeta.labels ?? {}) as Record<string, string>;
    return Boolean(labels[this.labelKey]);
  }

  /**
   * Starts watching Events in the configured namespace and emits normalized
   * RuntimeEvents to the configured EventSink.
   *
   * Returns a function that stops the watch when called.
   */
  async start(): Promise<() => void> {
    const request = await this.watch.watch(
      `/api/v1/namespaces/${this.config.namespace}/events`,
      {},
      (phase: string, obj: KubernetesObject) => {
        if (!this.filterByRunId(obj)) return;
        const signal = this.k8sToSignal(obj);
        this.sink.emit(normalizeK8sEventSignal(signal));
      },
      (err) => {
        if (err) console.error('[EventWatcher] watch error:', err);
      },
    );

    return () => request.abort();
  }

  private k8sToSignal(obj: KubernetesObject): K8sEventSignal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = obj as unknown as Record<string, unknown>;
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    const labels = (meta.labels ?? {}) as Record<string, string>;

    const involvedObject = (o.involvedObject ?? {}) as Record<string, unknown>;
    const involvedObjectMeta = (involvedObject.metadata ?? {}) as Record<string, unknown>;
    const involvedObjectLabels = (involvedObjectMeta.labels ?? {}) as Record<string, string>;

    return {
      involvedObject: {
        kind: (involvedObject.kind as string) ?? '',
        name: (involvedObject.name as string) ?? '',
        namespace: (involvedObject.namespace as string) ?? this.config.namespace,
        labels: involvedObjectLabels,
      },
      type: (o.type as 'Normal' | 'Warning') ?? 'Normal',
      reason: (o.reason as string) ?? '',
      message: (o.message as string) ?? '',
      timestamp: ((o.lastTimestamp as string | null) ?? null) ?? new Date().toISOString(),
      runId: involvedObjectLabels[this.labelKey],
      stepId: involvedObjectLabels['step_id'],
    };
  }
}
