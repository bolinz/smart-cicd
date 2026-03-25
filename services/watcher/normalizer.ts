import { v4 as uuid } from 'uuid';
import type { PodSignal, RuntimeEvent, PodEventKind, JobSignal } from './types';

function severityFromPhase(
  phase: PodSignal['phase'],
  kind: PodEventKind,
): RuntimeEvent['severity'] {
  if (kind === 'PodRestartCountChanged') return 'warning';
  switch (phase) {
    case 'Succeeded': return 'info';
    case 'Failed':    return 'error';
    case 'Pending':   return 'warning';
    case 'Running':    return 'debug';
    default:          return 'info';
  }
}

function kindFromChange(
  signal: PodSignal,
  prevRestartCount?: number,
): PodEventKind {
  if (signal.reason !== undefined) return 'PodTerminated';
  if (prevRestartCount !== undefined && signal.restartCount > prevRestartCount) return 'PodRestartCountChanged';
  return 'PodPhaseChanged';
}

export interface NormalizeOptions {
  prevRestartCount?: number;
}

export function normalizePodSignal(signal: PodSignal, opts: NormalizeOptions = {}): RuntimeEvent {
  const kind = kindFromChange(signal, opts.prevRestartCount);
  const severity = severityFromPhase(signal.phase, kind);

  let message: string;
  if (kind === 'PodTerminated') {
    message = `Pod ${signal.podName} terminated: ${signal.reason ?? 'unknown'} — ${signal.message ?? ''}`;
  } else if (kind === 'PodRestartCountChanged') {
    message = `Pod ${signal.podName} restart count increased from ${opts.prevRestartCount} to ${signal.restartCount}`;
  } else {
    message = `Pod ${signal.podName} transitioned to ${signal.phase}`;
  }

  const labels: Record<string, string> = {
    namespace: signal.namespace,
  };
  if (signal.runId)  labels.run_id  = signal.runId;
  if (signal.stepId) labels.step_id = signal.stepId;

  return {
    eventId: uuid(),
    runId: signal.runId ?? '',
    stepId: signal.stepId,
    timestamp: new Date().toISOString(),
    source: 'pod',
    kind,
    type: signal.phase,
    severity,
    message,
    labels,
    payload: {
      phase: signal.phase,
      restartCount: signal.restartCount,
      reason: signal.reason,
      message: signal.message,
    },
  };
}

export type JobEventKind = 'JobPhaseChanged';

export function severityFromJobPhase(phase: JobSignal['phase']): RuntimeEvent['severity'] {
  switch (phase) {
    case 'Active':   return 'debug';
    case 'Succeeded': return 'info';
    case 'Failed':   return 'error';
    default:         return 'info';
  }
}

export function normalizeJobSignal(signal: JobSignal): RuntimeEvent {
  const kind: JobEventKind = 'JobPhaseChanged';
  const severity = severityFromJobPhase(signal.phase);
  const message = `Job ${signal.jobName} transitioned to ${signal.phase}`;

  const labels: Record<string, string> = {
    namespace: signal.namespace,
  };
  if (signal.runId)  labels.run_id  = signal.runId;
  if (signal.stepId) labels.step_id = signal.stepId;

  return {
    eventId: uuid(),
    runId: signal.runId ?? '',
    stepId: signal.stepId,
    timestamp: new Date().toISOString(),
    source: 'job',
    kind,
    type: signal.phase,
    severity,
    message,
    labels,
    payload: {
      phase: signal.phase,
    },
  };
}
