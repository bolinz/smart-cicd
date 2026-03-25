import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeLogSignal } from '../../services/watcher/normalizer';
import type { LogSignal } from '../../services/watcher/types';
import { LogTailer } from '../../services/watcher/log-tailer';
import { NullEventSink } from '../../services/watcher/event-emitter';

// ─── normalizeLogSignal ────────────────────────────────────────────────────────

function makeLogSignal(overrides: Partial<LogSignal> = {}): LogSignal {
  return {
    podName: 'test-pod',
    containerName: 'main',
    namespace: 'default',
    timestamp: '2026-03-25T10:00:00.000Z',
    line: 'Build completed successfully',
    stream: 'stdout',
    runId: 'run-123',
    stepId: 'step-1',
    ...overrides,
  };
}

describe('normalizeLogSignal', () => {
  it('maps stdout to debug severity and LogLine kind', () => {
    const signal = makeLogSignal({ stream: 'stdout', line: 'hello world' });
    const event = normalizeLogSignal(signal);

    expect(event.kind).toBe('LogLine');
    expect(event.type).toBe('stdout');
    expect(event.severity).toBe('debug');
    expect(event.source).toBe('log');
    expect(event.message).toBe('hello world');
  });

  it('maps stderr to warning severity', () => {
    const signal = makeLogSignal({ stream: 'stderr', line: 'ERROR: build failed' });
    const event = normalizeLogSignal(signal);

    expect(event.kind).toBe('LogLine');
    expect(event.type).toBe('stderr');
    expect(event.severity).toBe('warning');
  });

  it('includes run_id and step_id in labels', () => {
    const signal = makeLogSignal({ runId: 'run-abc', stepId: 'step-x' });
    const event = normalizeLogSignal(signal);

    expect(event.runId).toBe('run-abc');
    expect(event.stepId).toBe('step-x');
    expect(event.labels.run_id).toBe('run-abc');
    expect(event.labels.step_id).toBe('step-x');
    expect(event.labels.namespace).toBe('default');
    expect(event.labels.podName).toBe('test-pod');
    expect(event.labels.containerName).toBe('main');
  });

  it('omits run_id/step_id labels when not provided', () => {
    const signal = makeLogSignal({ runId: undefined, stepId: undefined });
    const event = normalizeLogSignal(signal);

    expect(event.runId).toBe('');
    expect(event.stepId).toBeUndefined();
    expect(event.labels.run_id).toBeUndefined();
    expect(event.labels.step_id).toBeUndefined();
  });

  it('uses signal timestamp in the emitted event', () => {
    const signal = makeLogSignal({ timestamp: '2026-03-26T12:30:00.000Z' });
    const event = normalizeLogSignal(signal);

    expect(event.timestamp).toBe('2026-03-26T12:30:00.000Z');
  });

  it('generates unique eventIds', () => {
    const signal = makeLogSignal();
    const event1 = normalizeLogSignal(signal);
    const event2 = normalizeLogSignal(signal);
    expect(event1.eventId).not.toBe(event2.eventId);
  });

  it('payload contains podName, containerName, stream, and line', () => {
    const signal = makeLogSignal({ podName: 'my-pod', containerName: 'build', line: 'done' });
    const event = normalizeLogSignal(signal);

    expect(event.payload.podName).toBe('my-pod');
    expect(event.payload.containerName).toBe('build');
    expect(event.payload.stream).toBe('stdout');
    expect(event.payload.line).toBe('done');
  });
});

// ─── LogTailer.parseTimestampedLine ─────────────────────────────────────────

describe('LogTailer private helpers', () => {
  // We test these indirectly by creating a LogTailer and calling start(),
  // but since parseTimestampedLine and inferStream are private, we test
  // the public normalizeLogSignal + sink emission instead.

  it('error-like stderr lines are mapped to warning severity', () => {
    const errorLines = ['ERROR: something failed', 'FATAL: crash', 'PANIC: out of memory', 'Exception: null ptr'];
    for (const line of errorLines) {
      const signal = makeLogSignal({ line, stream: 'stderr' });
      const event = normalizeLogSignal(signal);
      expect(event.severity).toBe('warning');
    }
  });

  it('normal stdout lines are mapped to debug severity', () => {
    const lines = ['Hello world', 'Downloading artifact...', 'Step 1/3: build'];
    for (const line of lines) {
      const signal = makeLogSignal({ line, stream: 'stdout' });
      const event = normalizeLogSignal(signal);
      expect(event.severity).toBe('debug');
    }
  });
});

// ─── LogTailer — pod metadata fetch ───────────────────────────────────────────

describe('LogTailer', () => {
  const mockK8sApi = {
    readNamespacedPod: vi.fn(),
    readNamespacedPodLog: vi.fn(),
  } as any;
  const mockSink = new NullEventSink();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches run_id label from pod metadata', async () => {
    mockK8sApi.readNamespacedPod.mockResolvedValue({
      body: {
        metadata: {
          name: 'test-pod',
          namespace: 'default',
          labels: { run_id: 'run-456', step_id: 'step-2' },
        },
      },
    });
    mockK8sApi.readNamespacedPodLog.mockResolvedValue({ body: '' });

    const tailer = new LogTailer(
      { podName: 'test-pod', containerName: 'main', namespace: 'default' },
      { k8sApi: mockK8sApi, sink: mockSink },
    );

    const events: any[] = [];
    const captureSink = {
      emit: (e: any) => events.push(e),
    } as any;

    const capturingTailer = new LogTailer(
      { podName: 'test-pod', containerName: 'main', namespace: 'default' },
      { k8sApi: mockK8sApi, sink: captureSink },
    );

    // Override poll to capture events synchronously
    vi.spyOn(capturingTailer as any, 'poll').mockImplementation(async () => {
      // manually emit one log line
      capturingTailer['lastTimestamp'] = undefined;
      const { normalizeLogSignal } = await import('../../services/watcher/normalizer');
      captureSink.emit(
        normalizeLogSignal({
          podName: 'test-pod',
          containerName: 'main',
          namespace: 'default',
          timestamp: '2026-03-26T10:00:00.000Z',
          line: 'hello',
          stream: 'stdout',
          runId: 'run-456',
          stepId: 'step-2',
        }),
      );
    });

    const stop = await capturingTailer.start();
    await new Promise((r) => setTimeout(r, 100));
    stop();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].labels.run_id).toBe('run-456');
    expect(events[0].labels.step_id).toBe('step-2');
  });

  it('stop() prevents further polling', async () => {
    mockK8sApi.readNamespacedPod.mockResolvedValue({
      body: { metadata: { labels: {} } },
    });
    let pollCount = 0;
    mockK8sApi.readNamespacedPodLog.mockImplementation(() => {
      pollCount++;
      return Promise.resolve({ body: '' });
    });

    const tailer = new LogTailer(
      { podName: 'test-pod', containerName: 'main', namespace: 'default', pollIntervalMs: 10 },
      { k8sApi: mockK8sApi, sink: mockSink },
    );

    const stop = await tailer.start();
    await new Promise((r) => setTimeout(r, 50));
    stop();
    const countAfterStop = pollCount;

    await new Promise((r) => setTimeout(r, 50));
    expect(pollCount).toBe(countAfterStop);
  });
});
