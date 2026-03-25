---
"smart-cicd": minor
---

Add EventWatcher to complete the observation-plane watcher trio

- EventWatcher: watch Kubernetes events, filter by run_id label, emit normalized RuntimeEvents
- normalizeK8sEventSignal: Warning events → K8sWarningEvent (error severity); Normal events → K8sNormalEvent (info severity)
- K8sEventSignal type extended with involvedObject.labels, runId, stepId
- Unit tests: 11 new tests for event watcher and normalizer (all 25 tests passing)
