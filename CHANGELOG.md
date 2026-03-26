# smart-cicd

## 0.2.0

### Minor Changes

- 175b961: Add action-engine with policy-gated intervention execution

  - PolicyStore: loads and parses intervention-policy.yaml
  - ActionValidator: evaluates CandidateAction against allowed/guarded/forbidden rules and limits
  - InterventionExecutor: executes rerun-step, stop-run, restart-runner-pod, clear-cache-and-rerun
  - InterventionStore: in-memory persistence of InterventionRecord for audit trail
  - specs/intervention-policy.yaml: concrete allowed (4), guarded (2), forbidden (3) actions with limits
  - 24 new unit tests (126 total tests passing)

- 7c39a9f: Add control-plane orchestration module

  - SpecCompiler: validates PipelineSpec and compiles it into a RunGraph with step-level
    dependencies via topological sort
  - RunnerManager: generates K8s Job manifests with run_id/step_id labels and injects
    RUN_ID, STEP_ID, STEP_RUN_ID, ATTEMPT, BUILDER env vars into containers
  - RunOrchestrator: wires watchers → rule-engine → ai-supervisor → action-engine,
    manages PipelineRun/StepRun lifecycle, handles retries and run status transitions
  - 27 new unit tests (102 total tests passing)

- 4c68505: Restructure documentation into multi-language layout (English, Chinese Simplified) with shared templates and a root README index.
- b6fc3ca: Add EventWatcher to complete the observation-plane watcher trio

  - EventWatcher: watch Kubernetes events, filter by run_id label, emit normalized RuntimeEvents
  - normalizeK8sEventSignal: Warning events → K8sWarningEvent (error severity); Normal events → K8sNormalEvent (info severity)
  - K8sEventSignal type extended with involvedObject.labels, runId, stepId
  - Unit tests: 11 new tests for event watcher and normalizer (all 25 tests passing)

- f6aeb34: Initial release with Kubernetes-native agentic build platform

  - PodWatcher: observe Pod phase transitions, restart counts, and terminations
  - JobWatcher: observe Job phase transitions (Active, Succeeded, Failed)
  - EventEmitter + EventSink: normalized RuntimeEvent stream
  - Normalizer: convert raw K8s signals to structured RuntimeEvents
  - Rule engine, AI supervisor, action engine type definitions
  - GitHub Actions CI with typecheck and test
  - Changesets-based release workflow

- 03fab07: Add LogTailer to complete the observation-plane watcher collection

  - LogTailer: poll container logs from K8s pods, emit normalized LogLine events via EventSink
  - normalizeLogSignal: stdout → debug severity, stderr → warning severity
  - LogSignal.type extended with namespace field for label enrichment
  - Unit tests: 11 new tests for log tailer and normalizer (36 total tests passing)

- 29f3b1b: Add automated MiniMax AI PR review workflow

  - GitHub Actions workflow triggered on PR open/synchronize/reopen
  - review_pr.py: calls MiniMax API to analyze PR diff, posts review comments
  - review-policy.md: codifies architecture boundary rules as enforceable policy
  - review-prompt.md: system prompt for AI review behavior

### Patch Changes

- 2482d8b: fix(tooling): handle missing/invalid MINIMAX_API_KEY gracefully in PR review script

  - Check API key is non-empty before calling MiniMax API
  - Handle API error responses and unexpected shapes with clear error messages
  - Post descriptive comment on PR instead of crashing on KeyError
  - EnvironmentError exits gracefully; other errors exit with failure but post a comment

- f542d2a: Add comprehensive unit tests for rule-engine

  - 39 tests covering all 7 rule detectors (stuck-step, repeated-error, infra-failure, timeout-risk, resource-pressure, pull-backoff, scheduling-failure)
  - Tests for evaluateAllRules deduplication and runId/stepId propagation
  - Tests for escalateResults filtering
  - Replay scenarios: scheduling-failure, repeated-error, OOMKilled, healthy run

## 0.1.0

### Minor Changes

- f6aeb34: Initial release with Kubernetes-native agentic build platform

  - PodWatcher: observe Pod phase transitions, restart counts, and terminations
  - JobWatcher: observe Job phase transitions (Active, Succeeded, Failed)
  - EventEmitter + EventSink: normalized RuntimeEvent stream
  - Normalizer: convert raw K8s signals to structured RuntimeEvents
  - Rule engine, AI supervisor, action engine type definitions
  - GitHub Actions CI with typecheck and test
  - Changesets-based release workflow
