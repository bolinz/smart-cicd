import type { CoreV1Api, V1Pod } from '@kubernetes/client-node';
import type { LogSignal } from './types.js';
import { normalizeLogSignal } from './normalizer.js';
import type { EventBus } from './event-emitter.js';

const DEFAULT_LABEL_KEY = 'run_id';

export interface LogTailerConfig {
  podName: string;
  containerName: string;
  namespace: string;
  labelKey?: string;
}

/**
 * LogTailer fetches container logs from a Kubernetes Pod and emits
 * normalized RuntimeEvent (kind: LogLine) via the EventBus.
 *
 * Uses a single-shot fetch with timestamps enabled for MVP simplicity.
 * For long-lived pod streaming, use the K8s log follow API or polling.
 */
export class LogTailer {
  private readonly config: LogTailerConfig;
  private readonly k8sApi: CoreV1Api;
  private readonly sink: EventBus;
  private readonly labelKey: string;
  private aborted = false;

  constructor(config: LogTailerConfig, deps: { k8sApi: CoreV1Api; sink: EventBus }) {
    this.config = config;
    this.k8sApi = deps.k8sApi;
    this.sink = deps.sink;
    this.labelKey = config.labelKey ?? DEFAULT_LABEL_KEY;
  }

  async start(): Promise<() => void> {
    this.aborted = false;
    const { labels } = await this.fetchPodLabels();
    const runId = labels?.[this.labelKey];
    const stepId = labels?.['step_id'];
    this.fetchLogs(runId, stepId);
    return () => this.stop();
  }

  stop(): void {
    this.aborted = true;
  }

  private async fetchPodLabels(): Promise<{ labels?: Record<string, string> }> {
    try {
      const res = await this.k8sApi.readNamespacedPod(this.config.podName, this.config.namespace);
      const meta = (res.body as V1Pod).metadata ?? {};
      return { labels: meta.labels as Record<string, string> | undefined };
    } catch (err) {
      console.error('[LogTailer] failed to fetch pod labels:', err);
      return {};
    }
  }

  private async fetchLogs(runId?: string, stepId?: string): Promise<void> {
    if (this.aborted) return;

    try {
      const res = await this.k8sApi.readNamespacedPodLog(
        this.config.podName,
        this.config.namespace,
        this.config.containerName,
        false,      // follow — single-shot fetch
        false,      // insecureSkipTLSVerifyBackend
        undefined,  // limitBytes
        undefined,  // pretty
        false,      // previous
        undefined,  // sinceSeconds
        undefined,  // tailLines
        true,       // timestamps
      );

      const body = res.body as string;
      if (body) {
        const lines = body.split('\n');
        for (const rawLine of lines) {
          if (this.aborted) return;
          if (!rawLine.trim()) continue;
          const { timestamp, content, stream } = this.parseTimestampedLine(rawLine);
          const signal: LogSignal = {
            podName: this.config.podName,
            containerName: this.config.containerName,
            namespace: this.config.namespace,
            timestamp: timestamp ?? new Date().toISOString(),
            line: content,
            stream: stream ?? this.inferStream(content),
            runId,
            stepId,
          };
          this.sink.emit(normalizeLogSignal(signal));
        }
      }
    } catch (err) {
      if (!this.aborted) {
        console.error('[LogTailer] stream error:', err);
      }
    }
  }

  private parseTimestampedLine(
    line: string,
  ): { timestamp: string | undefined; content: string; stream?: 'stdout' | 'stderr' } {
    const match = line.match(/^(\S+)\s+(stdout|stderr)\s+F\s+(.*)$/);
    if (match) {
      return { timestamp: match[1], content: match[3], stream: match[2] as 'stdout' | 'stderr' };
    }
    return { timestamp: undefined, content: line };
  }

  private inferStream(line: string): 'stdout' | 'stderr' {
    const lower = line.toLowerCase();
    if (
      lower.startsWith('error') ||
      lower.startsWith('fatal') ||
      lower.startsWith('panic') ||
      lower.startsWith('exception') ||
      lower.startsWith('fail')
    ) {
      return 'stderr';
    }
    return 'stdout';
  }
}
