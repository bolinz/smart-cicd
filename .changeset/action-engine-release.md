---
"smart-cicd": minor
---

Add action-engine with policy-gated intervention execution

- PolicyStore: loads and parses intervention-policy.yaml
- ActionValidator: evaluates CandidateAction against allowed/guarded/forbidden rules and limits
- InterventionExecutor: executes rerun-step, stop-run, restart-runner-pod, clear-cache-and-rerun
- InterventionStore: in-memory persistence of InterventionRecord for audit trail
- specs/intervention-policy.yaml: concrete allowed (4), guarded (2), forbidden (3) actions with limits
- 24 new unit tests (126 total tests passing)


