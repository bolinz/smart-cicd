# Watcher

Collects and normalizes runtime signals: Pod/Job status, Kubernetes events, logs, metrics. Emits normalized `RuntimeEvent`s downstream via `EventSink`.

## Components

- **PodWatcher** (`pod-watcher.ts`) — watches Pods with `run_id` label, emits `PodSignal`s
- **normalizer** (`normalizer.ts`) — converts `PodSignal` → `RuntimeEvent`
- **event-emitter** (`event-emitter.ts`) — `EventSink` interface for downstream consumers

## Boundaries

- Only collects and normalizes; does not diagnose or act
- Must not trigger interventions directly
- All observation flows through `EventSink`
