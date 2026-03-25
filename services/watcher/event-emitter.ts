import type { RuntimeEvent } from './types';

/**
 * EventSink is the interface through which downstream components receive
 * normalized RuntimeEvents. Implemented by watchers; consumed by rule-engine,
 * ai-supervisor, and other observation-plane clients.
 */
export interface EventSink {
  emit(event: RuntimeEvent): void;
}

/** No-op sink for testing and default construction. */
export class NullEventSink implements EventSink {
  emit(_event: RuntimeEvent): void {
    // intentionally empty
  }
}
