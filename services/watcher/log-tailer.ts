import type { CoreV1Api } from '@kubernetes/client-node';
import type { LogSignal } from './types';
import { normalizeLogSignal } from './normalizer';
import type { EventSink } from './event-emitter';

const DEFAULT_LABEL_KEY = 'run_id';
const DEFAULT_POLL_INTERVAL_MS = 2000;

export interface LogTailerConfig {
  podName: string;
  containerName: string;
  namespace: string;
  /** Label key for run ID. Defaults to "run_id". */
  labelKey?: string;
  /**
   * Poll interval in milliseconds between log polls.
   * Default: 2000ms
   */
  pollIntervalMs?: number;
}

/**
 * LogTailer polls container logs from a Kubernetes Pod and emits
 * normalized RuntimeEvent (kind: LogLine) via the EventSink.
 *
 * Uses a simple polling strategy with timestamps to avoid duplicate
 * log lines. Tracks the last-seen timestamp per tailer instance.
 */
export class LogTailer {
  private readonly config: LogTailerConfig;
  private readonly k8sApi: CoreV1Api;
  private readonly sink: EventSink;
  private readonly labelKey: string;
  private stopped = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTimestamp: string | undefined;

  constructor(config: LogTailerConfig, deps: { k8sApi: CoreV1Api; sink: EventSink }) {
    this.config = config;
    this.k8sApi = deps.k8sApi;
    this.sink = deps.sink;
    this.labelKey = config.labelKey ?? DEFAULT_LABEL_KEY;
  }

  /**
   * Starts polling logs from the configured pod/container.
   * Fetches pod metadata to extract run_id / step_id labels.
   * Returns a function that stops the tailer when called.
   */
  async start(): Promise<() => void> {
    this.stopped = false;
    const { labels } = await this.fetchPodLabels();
    const runId = labels?.[this.labelKey];
    const stepId = labels?.['step_id'];

    this.poll(runId, stepId);

    return () => this.stop();
  }

  /**
   * Stops the polling loop.
   */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchPodLabels(): Promise<{ labels?: Record<string, string> }> {
    try {
      const res = await this.k8sApi.readNamespacedPod(
        this.config.podName,
        this.config.namespace,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (res.body.metadata as any) ?? {};
      return { labels: meta.labels as Record<string, string> | undefined };
    } catch {
      return {};
    }
  }

  private async poll(runId?: string, stepId?: string): Promise<void> {
    if (this.stopped) return;

    try {
      const res = await this.k8sApi.readNamespacedPodLog(
        this.config.podName,
        this.config.namespace,
        this.config.containerName,
      );

      const body = (res.body as string) ?? '';
      if (body) {
        const lines = body.split('\n');
        for (const rawLine of lines) {
          if (!rawLine.trim()) continue;
          const { timestamp, content } = this.parseTimestampedLine(rawLine);
          if (timestamp && timestamp <= (this.lastTimestamp ?? '')) {
            // Skip already-seen lines
            continue;
          }
          if (timestamp) this.lastTimestamp = timestamp;

          const signal: LogSignal = {
            podName: this.config.podName,
            containerName: this.config.containerName,
            namespace: this.config.namespace,
            timestamp: timestamp ?? new Date().toISOString(),
            line: content,
            stream: this.inferStream(content),
            runId,
            stepId,
          };
          this.sink.emit(normalizeLogSignal(signal));
        }
      }
    } catch (err) {
      console.error('[LogTailer] poll error:', err);
    }

    const delay = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimer = setTimeout(() => {
      this.poll(runId, stepId);
    }, delay);
  }

  /**
   * Parse a K8s timestamped log line.
   * Format: "2026-03-25T10:00:00.000Z stdout F <message>"
   */
  private parseTimestampedLine(
    line: string,
  ): { timestamp: string | undefined; content: string } {
    // K8s format with timestamps: "<timestamp> <stream> F <content>"
    // e.g. "2026-03-25T10:00:00.000Z stdout F my log message"
    const match = line.match(/^(\S+)\s+(stdout|stderr)\s+F\s+(.*)$/);
    if (match) {
      return { timestamp: match[1], content: match[3] };
    }
    return { timestamp: undefined, content: line };
  }

  /**
   * Infer the stream from log line content.
   * Lines that look like errors are treated as stderr.
   */
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
