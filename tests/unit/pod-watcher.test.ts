import { describe, it, expect } from 'vitest';
import { normalizePodSignal } from '../../services/watcher/normalizer';
import type { PodSignal } from '../../services/watcher/types';
import { PodWatcher } from '../../services/watcher/pod-watcher';
import { NullEventSink } from '../../services/watcher/event-emitter';
import type { CoreV1Api, Watch, KubernetesObject } from '@kubernetes/client-node';

function makePodSignal(overrides: Partial<PodSignal> = {}): PodSignal {
  return {
    podName: 'test-pod',
    namespace: 'default',
    phase: 'Running',
    restartCount: 0,
    runId: 'run-123',
    stepId: 'step-1',
    ...overrides,
  };
}

describe('normalizePodSignal', () => {
  it('maps PodPhaseChanged for a Running phase with debug severity', () => {
    const signal = makePodSignal({ phase: 'Running' });
    const event = normalizePodSignal(signal);

    expect(event.kind).toBe('PodPhaseChanged');
    expect(event.type).toBe('Running');
    expect(event.severity).toBe('debug');
    expect(event.source).toBe('pod');
    expect(event.runId).toBe('run-123');
    expect(event.stepId).toBe('step-1');
    expect(event.labels.run_id).toBe('run-123');
    expect(event.labels.namespace).toBe('default');
    expect(event.payload.phase).toBe('Running');
  });

  it('maps PodPhaseChanged for Succeeded with info severity', () => {
    const signal = makePodSignal({ phase: 'Succeeded' });
    const event = normalizePodSignal(signal);

    expect(event.kind).toBe('PodPhaseChanged');
    expect(event.severity).toBe('info');
  });

  it('maps PodPhaseChanged for Failed with error severity', () => {
    const signal = makePodSignal({ phase: 'Failed' });
    const event = normalizePodSignal(signal);

    expect(event.kind).toBe('PodPhaseChanged');
    expect(event.severity).toBe('error');
  });

  it('maps PodPhaseChanged for Pending with warning severity', () => {
    const signal = makePodSignal({ phase: 'Pending' });
    const event = normalizePodSignal(signal);

    expect(event.kind).toBe('PodPhaseChanged');
    expect(event.severity).toBe('warning');
  });

  it('maps PodTerminated when reason is present', () => {
    const signal = makePodSignal({
      phase: 'Failed',
      reason: 'OOMKilled',
      message: 'Container out of memory',
    });
    const event = normalizePodSignal(signal);

    expect(event.kind).toBe('PodTerminated');
    expect(event.severity).toBe('error');
    expect(event.payload.reason).toBe('OOMKilled');
    expect(event.payload.message).toBe('Container out of memory');
  });

  it('maps PodRestartCountChanged when restart count increases', () => {
    const signal = makePodSignal({ restartCount: 3 });
    const event = normalizePodSignal(signal, { prevRestartCount: 1 });

    expect(event.kind).toBe('PodRestartCountChanged');
    expect(event.severity).toBe('warning');
    expect(event.message).toContain('3');
    expect(event.message).toContain('1');
  });

  it('maps PodPhaseChanged before a restart count change is detected', () => {
    const signal = makePodSignal({ restartCount: 1 });
    const event = normalizePodSignal(signal); // no prevRestartCount

    expect(event.kind).toBe('PodPhaseChanged');
  });

  it('includes run_id and step_id in labels', () => {
    const signal = makePodSignal({ runId: 'run-abc', stepId: 'step-x' });
    const event = normalizePodSignal(signal);

    expect(event.labels.run_id).toBe('run-abc');
    expect(event.labels.step_id).toBe('step-x');
  });

  it('omits optional fields gracefully when not provided', () => {
    const signal: PodSignal = {
      podName: 'bare-pod',
      namespace: 'default',
      phase: 'Unknown',
      restartCount: 0,
    };
    const event = normalizePodSignal(signal);

    expect(event.runId).toBe('');
    expect(event.stepId).toBeUndefined();
    expect(event.labels.run_id).toBeUndefined();
  });

  it('generates unique eventIds', () => {
    const signal = makePodSignal();
    const event1 = normalizePodSignal(signal);
    const event2 = normalizePodSignal(signal);
    expect(event1.eventId).not.toBe(event2.eventId);
  });
});

describe('PodWatcher.filterByRunId', () => {
  const mockK8sApi = {} as CoreV1Api;
  const mockWatch = {} as Watch;

  function watcherWithLabelKey(labelKey: string): PodWatcher {
    return new PodWatcher(
      { namespace: 'default', labelKey },
      { k8sApi: mockK8sApi, watch: mockWatch, sink: new NullEventSink() },
    );
  }

  function podWithLabels(labels: Record<string, string>): KubernetesObject {
    // KubernetesObject.metadata is typed as KubernetesMeta | undefined.
    // Use explicit any cast to tell TypeScript the labels field is present.
    return { metadata: { name: 'pod', namespace: 'default', labels } } as unknown as KubernetesObject;
  }

  it('returns true when the configured label key is present', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId(podWithLabels({ run_id: 'run-123' }))).toBe(true);
  });

  it('returns false when the configured label key is absent', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId(podWithLabels({ app: 'my-app' }))).toBe(false);
  });

  it('returns false when labels are undefined', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId({ metadata: {} } as KubernetesObject)).toBe(false);
  });

  it('respects custom label key', () => {
    const w = watcherWithLabelKey('pipeline_id');
    expect(w.filterByRunId(podWithLabels({ pipeline_id: 'pipe-1' }))).toBe(true);
    expect(w.filterByRunId(podWithLabels({ run_id: 'run-1' }))).toBe(false);
  });
});
