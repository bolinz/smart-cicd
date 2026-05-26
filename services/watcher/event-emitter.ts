import type { RuntimeEvent } from './types.js';

/**
 * EventBus is the interface through which downstream components receive
 * normalized RuntimeEvents. Implemented by watchers; consumed by rule-engine,
 * ai-supervisor, and other observation-plane clients.
 */
export interface EventBus {
  emit(event: RuntimeEvent): void;
}

/** No-op sink for testing and default construction. */
export class NullEventSink implements EventBus {
  emit(_event: RuntimeEvent): void {
    // intentionally empty
  }
}
