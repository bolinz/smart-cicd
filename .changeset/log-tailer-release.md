---
"smart-cicd": minor
---

Add LogTailer to complete the observation-plane watcher collection

- LogTailer: poll container logs from K8s pods, emit normalized LogLine events via EventSink
- normalizeLogSignal: stdout → debug severity, stderr → warning severity
- LogSignal.type extended with namespace field for label enrichment
- Unit tests: 11 new tests for log tailer and normalizer (36 total tests passing)
