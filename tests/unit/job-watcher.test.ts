import { describe, it, expect } from 'vitest';
import { normalizeJobSignal, severityFromJobPhase } from '../../services/watcher/normalizer.js';
import type { JobSignal } from '../../services/watcher/types.js';
import { JobWatcher } from '../../services/watcher/job-watcher.js';
import { NullEventSink } from '../../services/watcher/event-emitter.js';
import type { BatchV1Api, Watch, KubernetesObject } from '@kubernetes/client-node';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJobSignal(overrides: Partial<JobSignal> = {}): JobSignal {
  return {
    jobName: 'test-job',
    namespace: 'default',
    phase: 'Active',
    runId: 'run-123',
    stepId: 'step-1',
    ...overrides,
  };
}

// ─── severityFromJobPhase ─────────────────────────────────────────────────────

describe('severityFromJobPhase', () => {
  it('maps Active to debug', () => {
    expect(severityFromJobPhase('Active')).toBe('debug');
  });

  it('maps Succeeded to info', () => {
    expect(severityFromJobPhase('Succeeded')).toBe('info');
  });

  it('maps Failed to error', () => {
    expect(severityFromJobPhase('Failed')).toBe('error');
  });
});

// ─── normalizeJobSignal ───────────────────────────────────────────────────────

describe('normalizeJobSignal', () => {
  it('maps JobPhaseChanged for Active phase with debug severity', () => {
    const signal = makeJobSignal({ phase: 'Active' });
    const event = normalizeJobSignal(signal);

    expect(event.kind).toBe('JobPhaseChanged');
    expect(event.type).toBe('Active');
    expect(event.severity).toBe('debug');
    expect(event.source).toBe('job');
    expect(event.runId).toBe('run-123');
    expect(event.stepId).toBe('step-1');
    expect(event.labels.run_id).toBe('run-123');
    expect(event.labels.namespace).toBe('default');
    expect(event.payload.phase).toBe('Active');
  });

  it('maps JobPhaseChanged for Succeeded with info severity', () => {
    const signal = makeJobSignal({ phase: 'Succeeded' });
    const event = normalizeJobSignal(signal);

    expect(event.kind).toBe('JobPhaseChanged');
    expect(event.severity).toBe('info');
    expect(event.type).toBe('Succeeded');
  });

  it('maps JobPhaseChanged for Failed with error severity', () => {
    const signal = makeJobSignal({ phase: 'Failed' });
    const event = normalizeJobSignal(signal);

    expect(event.kind).toBe('JobPhaseChanged');
    expect(event.severity).toBe('error');
    expect(event.type).toBe('Failed');
  });

  it('message includes job name and phase', () => {
    const signal = makeJobSignal({ jobName: 'my-build-job', phase: 'Failed' });
    const event = normalizeJobSignal(signal);

    expect(event.message).toContain('my-build-job');
    expect(event.message).toContain('Failed');
  });

  it('includes run_id and step_id in labels', () => {
    const signal = makeJobSignal({ runId: 'run-abc', stepId: 'step-x' });
    const event = normalizeJobSignal(signal);

    expect(event.labels.run_id).toBe('run-abc');
    expect(event.labels.step_id).toBe('step-x');
  });

  it('omits optional fields gracefully when not provided', () => {
    const signal: JobSignal = {
      jobName: 'bare-job',
      namespace: 'default',
      phase: 'Active',
    };
    const event = normalizeJobSignal(signal);

    expect(event.runId).toBe('');
    expect(event.stepId).toBeUndefined();
    expect(event.labels.run_id).toBeUndefined();
    expect(event.labels.step_id).toBeUndefined();
  });

  it('generates unique eventIds', () => {
    const signal = makeJobSignal();
    const event1 = normalizeJobSignal(signal);
    const event2 = normalizeJobSignal(signal);
    expect(event1.eventId).not.toBe(event2.eventId);
  });

  it('payload contains phase', () => {
    const signal = makeJobSignal({ jobName: 'my-job', phase: 'Succeeded' });
    const event = normalizeJobSignal(signal);

    expect(event.payload.phase).toBe('Succeeded');
  });
});

// ─── JobWatcher.filterByRunId ────────────────────────────────────────────────

describe('JobWatcher.filterByRunId', () => {
  const mockBatchApi = {} as BatchV1Api;
  const mockWatch = {} as Watch;

  function watcherWithLabelKey(labelKey: string): JobWatcher {
    return new JobWatcher(
      { namespace: 'default', labelKey },
      { k8sApi: mockBatchApi, watch: mockWatch, sink: new NullEventSink() },
    );
  }

  function jobWithLabels(labels: Record<string, string>): KubernetesObject {
    return {
      metadata: { name: 'job', namespace: 'default', labels },
    } as unknown as KubernetesObject;
  }

  it('returns true when the configured label key is present', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId(jobWithLabels({ run_id: 'run-123' }))).toBe(true);
  });

  it('returns false when the configured label key is absent', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId(jobWithLabels({ app: 'my-app' }))).toBe(false);
  });

  it('returns false when labels are undefined', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId({ metadata: {} } as unknown as KubernetesObject)).toBe(false);
  });

  it('respects custom label key', () => {
    const w = watcherWithLabelKey('pipeline_id');
    expect(w.filterByRunId(jobWithLabels({ pipeline_id: 'pipe-1' }))).toBe(true);
    expect(w.filterByRunId(jobWithLabels({ run_id: 'run-1' }))).toBe(false);
  });

  it('returns false when labels object is missing', () => {
    const w = watcherWithLabelKey('run_id');
    expect(w.filterByRunId({ metadata: { name: 'job' } } as unknown as KubernetesObject)).toBe(false);
  });
});
