// Core types for watcher

export type EventSource = 'pod' | 'job' | 'event' | 'log' | 'metrics';
export type EventSeverity = 'debug' | 'info' | 'warning' | 'error';
export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
export type JobPhase = 'Active' | 'Succeeded' | 'Failed';

export type PodEventKind = 'PodPhaseChanged' | 'PodRestartCountChanged' | 'PodTerminated';

export interface RuntimeEvent {
  eventId: string;
  runId: string;
  stepId?: string;
  timestamp: string;
  source: EventSource;
  kind: string;
  type: string;
  severity: EventSeverity;
  message: string;
  labels: Record<string, string>;
  payload: Record<string, unknown>;
}

export interface PodWatcherConfig {
  namespace: string;
  /** Label key to filter watched pods. Defaults to "run_id". */
  labelKey?: string;
}

export interface PodSignal {
  podName: string;
  namespace: string;
  phase: PodPhase;
  restartCount: number;
  reason?: string;
  message?: string;
  runId?: string;
  stepId?: string;
}

export interface JobSignal {
  jobName: string;
  namespace: string;
  phase: JobPhase;
  runId?: string;
  stepId?: string;
}

export interface K8sEventSignal {
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
    labels?: Record<string, string>;
  };
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  timestamp: string;
  runId?: string;
  stepId?: string;
}

export interface LogSignal {
  podName: string;
  containerName: string;
  timestamp: string;
  line: string;
  stream: 'stdout' | 'stderr';
  runId?: string;
  stepId?: string;
}
