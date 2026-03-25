---
"smart-cicd": patch
---

Add comprehensive unit tests for rule-engine

- 39 tests covering all 7 rule detectors (stuck-step, repeated-error, infra-failure, timeout-risk, resource-pressure, pull-backoff, scheduling-failure)
- Tests for evaluateAllRules deduplication and runId/stepId propagation
- Tests for escalateResults filtering
- Replay scenarios: scheduling-failure, repeated-error, OOMKilled, healthy run
