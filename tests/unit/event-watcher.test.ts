import { describe, it, expect } from 'vitest';
import { normalizeK8sEventSignal } from '../../services/watcher/normalizer.js';
import type { K8sEventSignal } from '../../services/watcher/types.js';
import { EventWatcher } from '../../services/watcher/event-watcher.js';
import { NullEventSink } from '../../services/watcher/event-emitter.js';
import type { CoreV1Api, Watch, KubernetesObject } from '@kubernetes/client-node';

function makeK8sEventSignal(overrides: Partial<K8sEventSignal> = {}): K8sEventSignal {
  return {
    involvedObject: {
      kind: 'Pod',
      name: 'test-pod',
      namespace: 'default',
      labels: { run_id: 'run-123', step_id: 'step-1' },
    },
    type: 'Normal',
    reason: 'Started',
    message: 'Container started successfully',
    timestamp: '2026-03-25T10:00:00.000Z',
    runId: 'run-123',
    stepId: 'step-1',
    ...overrides,
  };
}

describe('normalizeK8sEventSignal', () => {
  it('maps Warning type to K8sWarningEvent kind and error severity', () => {
    const signal = makeK8sEventSignal({ type: 'Warning', reason: 'Unhealthy', message: 'Liveness probe failed' });
    const event = normalizeK8sEventSignal(signal);

    expect(event.kind).toBe('K8sWarningEvent');
    expect(event.type).toBe('Warning');
    expect(event.severity).toBe('error');
    expect(event.source).toBe('event');
    expect(event.message).toBe('[Unhealthy] Liveness probe failed');
    expect(event.payload.reason).toBe('Unhealthy');
    expect(event.payload.involvedObjectKind).toBe('Pod');
    expect(event.payload.involvedObjectName).toBe('test-pod');
  });

  it('maps Normal type to K8sNormalEvent kind and info severity', () => {
    const signal = makeK8sEventSignal({ type: 'Normal', reason: 'Pulled', message: 'Container image pulled' });
    const event = normalizeK8sEventSignal(signal);

    expect(event.kind).toBe('K8sNormalEvent');
    expect(event.type).toBe('Normal');
    expect(event.severity).toBe('info');
    expect(event.source).toBe('event');
  });

  it('includes run_id and step_id in labels when present', () => {
    const signal = makeK8sEventSignal({ runId: 'run-abc', stepId: 'step-x' });
    const event = normalizeK8sEventSignal(signal);

    expect(event.runId).toBe('run-abc');
    expect(event.stepId).toBe('step-x');
    expect(event.labels.run_id).toBe('run-abc');
    expect(event.labels.step_id).toBe('step-x');
    expect(event.labels.namespace).toBe('default');
    expect(event.labels.involvedObjectKind).toBe('Pod');
    expect(event.labels.involvedObjectName).toBe('test-pod');
  });

  it('omits run_id and step_id from labels when not provided', () => {
    const signal = makeK8sEventSignal({ runId: undefined, stepId: undefined });
    const event = normalizeK8sEventSignal(signal);

    expect(event.runId).toBe('');
    expect(event.stepId).toBeUndefined();
    expect(event.labels.run_id).toBeUndefined();
    expect(event.labels.step_id).toBeUndefined();
  });

  it('uses signal timestamp in the emitted event', () => {
    const signal = makeK8sEventSignal({ timestamp: '2026-03-25T12:30:00.000Z' });
    const event = normalizeK8sEventSignal(signal);

    expect(event.timestamp).toBe('2026-03-25T12:30:00.000Z');
  });

  it('generates unique eventIds', () => {
    const signal = makeK8sEventSignal();
    const event1 = normalizeK8sEventSignal(signal);
    const event2 = normalizeK8sEventSignal(signal);
    expect(event1.eventId).not.toBe(event2.eventId);
  });

  it('handles missing involvedObject labels gracefully', () => {
    const signal: K8sEventSignal = {
      involvedObject: {
        kind: 'Pod',
        name: 'orphan-pod',
        namespace: 'default',
      },
      type: 'Warning',
      reason: 'Scheduled',
      message: 'Pod scheduled',
      timestamp: '2026-03-25T10:00:00.000Z',
    };
    const event = normalizeK8sEventSignal(signal);

    expect(event.runId).toBe('');
    expect(event.labels.run_id).toBeUndefined();
  });
});

describe('EventWatcher.filterByRunId', () => {
  const mockK8sApi = {} as CoreV1Api;
  const mockWatch = {} as Watch;

  function watcherWithLabelKey(labelKey: string): EventWatcher {
    return new EventWatcher(
      { namespace: 'default', labelKey },
      { k8sApi: mockK8sApi, watch: mockWatch, sink: new NullEventSink() },
    );
  }

  function eventWithInvolvedObjectLabels(labels: Record<string, string>): KubernetesObject {
    // K8s events expose the involved object's labels under involvedObject.metadata.labels
    return {
      involvedObject: {
        kind: 'Pod',
        name: 'pod',
        namespace: 'default',
        metadata: { labels },
      },
      reason: 'Started',
      message: 'ok',
      type: 'Normal',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as KubernetesObject;
  }

  it('returns true when the involved object has the configured label key', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId(eventWithInvolvedObjectLabels({ run_id: 'run-123' }))).toBe(true);
  });

  it('returns false when the involved object lacks the configured label key', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId(eventWithInvolvedObjectLabels({ app: 'my-app' }))).toBe(false);
  });

  it('returns false when involvedObject labels are undefined', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId({ metadata: {} } as unknown as KubernetesObject)).toBe(false);
  });

  it('respects custom label key', () => {
    const w = watcherWithLabelKey('pipeline_id');
    expect(w.filterByRunId(eventWithInvolvedObjectLabels({ pipeline_id: 'pipe-1' }))).toBe(true);
    expect(w.filterByRunId(eventWithInvolvedObjectLabels({ run_id: 'run-1' }))).toBe(false);
  });
});
