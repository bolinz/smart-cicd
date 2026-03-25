import type { RuleEvaluator, RuleResult, DetectionContext } from './types';
import type { RuntimeEvent } from '../watcher/types';

/** Threshold constants */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const REPEATED_ERROR_COUNT = 3;
const REPEATED_ERROR_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function now(): string {
  return new Date().toISOString();
}

function eventAgeMs(event: RuntimeEvent): number {
  return Date.now() - new Date(event.timestamp).getTime();
}

function eventsInWindow(
  events: RuntimeEvent[],
  windowMs: number,
  predicate: (e: RuntimeEvent) => boolean,
): RuntimeEvent[] {
  const cutoff = Date.now() - windowMs;
  return events.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoff && predicate(e),
  );
}

function sameErrorSignature(e: RuntimeEvent): string {
  return `${e.kind}:${e.type}:${e.message.slice(0, 80)}`;
}

/** stuck-step: no progress for N seconds */
export const stuckStepRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const progressEvents = events.filter((e) => e.severity !== 'debug' && e.severity !== 'info');
  if (progressEvents.length < 2) return null;

  const latest = progressEvents.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  );

  if (eventAgeMs(latest) > STUCK_THRESHOLD_MS) {
    return {
      rule: 'stuck-step',
      severity: latest.severity === 'error' ? 'critical' : 'warning',
      runId,
      stepId: ctx.stepRunId,
      message: `No progress detected for ${Math.round(eventAgeMs(latest) / 1000)}s`,
      evidence: [`Last event: ${latest.message}`, `At: ${latest.timestamp}`],
      shouldEscalate: true,
      timestamp: now(),
    };
  }

  return null;
};

/** repeated-error: same error occurring multiple times */
export const repeatedErrorRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const windowErrors = eventsInWindow(events, REPEATED_ERROR_WINDOW_MS, (e) => e.severity === 'error');

  const sigCounts = new Map<string, RuntimeEvent[]>();
  for (const e of windowErrors) {
    const sig = sameErrorSignature(e);
    const list = sigCounts.get(sig) ?? [];
    list.push(e);
    sigCounts.set(sig, list);
  }

  for (const [, errs] of sigCounts) {
    if (errs.length >= REPEATED_ERROR_COUNT) {
      return {
        rule: 'repeated-error',
        severity: 'critical',
        runId,
        stepId: ctx.stepRunId,
        message: `Same error repeated ${errs.length} times: "${errs[0].message.slice(0, 100)}"`,
        evidence: errs.map((e) => `${e.timestamp} — ${e.message}`),
        shouldEscalate: true,
        timestamp: now(),
      };
    }
  }

  return null;
};

/** infra-failure: infrastructure-level failure from K8s events */
export const infraFailureRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const infraReasons = ['Failed', 'OOMKilled', 'Evicted', 'NodeLost', 'Unknown'];

  const infraEvents = events.filter((e) => {
    if (e.source === 'event' && e.kind === 'K8sWarningEvent') return true;
    if (e.source === 'pod' && e.kind === 'PodTerminated') {
      const reason = (e.payload.reason as string) ?? '';
      return infraReasons.some((r) => reason.includes(r));
    }
    return false;
  });

  if (infraEvents.length === 0) return null;

  const latest = infraEvents.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  );

  return {
    rule: 'infra-failure',
    severity: 'critical',
    runId,
    stepId: ctx.stepRunId,
    message: `Infrastructure failure detected: ${latest.message}`,
    evidence: infraEvents.map((e) => `${e.timestamp} [${e.source}] ${e.message}`),
    shouldEscalate: true,
    timestamp: now(),
  };
};

/** timeout-risk: step running too long without completion */
export const timeoutRiskRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const runningEvents = events.filter(
    (e) => e.source === 'pod' && e.type === 'Running',
  );

  if (runningEvents.length === 0) return null;

  const latest = runningEvents.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  );

  const runningMs = eventAgeMs(latest);
  if (runningMs > 10 * 60 * 1000) {
    return {
      rule: 'timeout-risk',
      severity: 'warning',
      runId,
      stepId: ctx.stepRunId,
      message: `Pod running for ${Math.round(runningMs / 1000)}s — may be approaching timeout`,
      evidence: [`Running since: ${latest.timestamp}`, `Age: ${Math.round(runningMs / 1000)}s`],
      shouldEscalate: false,
      timestamp: now(),
    };
  }

  return null;
};

/** resource-pressure: memory/disk pressure indicators */
export const resourcePressureRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const resourceKeywords = ['oomkilled', 'diskpressure', 'memorypressure', 'evicted', 'allocated'];

  const pressureEvents = events.filter((e) => {
    const msg = e.message.toLowerCase();
    const kind = e.kind.toLowerCase();
    return (
      resourceKeywords.some((k) => msg.includes(k) || kind.includes(k)) ||
      (e.source === 'pod' && e.kind === 'PodTerminated' && (e.payload.reason as string)?.toLowerCase().includes('oomkilled'))
    );
  });

  if (pressureEvents.length === 0) return null;

  return {
    rule: 'resource-pressure',
    severity: 'critical',
    runId,
    stepId: ctx.stepRunId,
    message: `Resource pressure detected: ${pressureEvents[0].message}`,
    evidence: pressureEvents.map((e) => `${e.timestamp} — ${e.message}`),
    shouldEscalate: true,
    timestamp: now(),
  };
};

/** pull-backoff: image pull issues */
export const pullBackoffRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const pullKeywords = ['pull', 'image', 'backoff', 'registry', 'docker'];

  const pullEvents = events.filter((e) => {
    const msg = e.message.toLowerCase();
    return (
      pullKeywords.some((k) => msg.includes(k)) ||
      (e.source === 'event' && e.kind === 'K8sWarningEvent' && msg.includes('pull'))
    );
  });

  if (pullEvents.length < 2) return null;

  return {
    rule: 'pull-backoff',
    severity: 'warning',
    runId,
    stepId: ctx.stepRunId,
    message: `Image pull issue detected: ${pullEvents[0].message}`,
    evidence: pullEvents.slice(0, 5).map((e) => `${e.timestamp} — ${e.message}`),
    shouldEscalate: false,
    timestamp: now(),
  };
};

/** scheduling-failure: pod scheduling failure */
export const schedulingFailureRule: RuleEvaluator = (ctx: DetectionContext): RuleResult | null => {
  const { events, runId } = ctx;

  const pendingPods = events.filter(
    (e) => e.source === 'pod' && e.type === 'Pending' && e.kind === 'PodPhaseChanged',
  );
  const hasRunning = events.some((e) => e.source === 'pod' && e.type === 'Running');

  if (pendingPods.length > 0 && !hasRunning) {
    const oldestPending = pendingPods.reduce((a, b) =>
      new Date(a.timestamp) < new Date(b.timestamp) ? a : b,
    );

    if (eventAgeMs(oldestPending) > 2 * 60 * 1000) {
      return {
        rule: 'scheduling-failure',
        severity: 'critical',
        runId,
        stepId: ctx.stepRunId,
        message: `Pod stuck in Pending for ${Math.round(eventAgeMs(oldestPending) / 1000)}s — possible scheduling failure`,
        evidence: [`Pending since: ${oldestPending.timestamp}`, `Events: ${pendingPods.length}`],
        shouldEscalate: true,
        timestamp: now(),
      };
    }
  }

  return null;
};
