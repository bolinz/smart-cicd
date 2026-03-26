---
"smart-cicd": minor
---

Add control-plane orchestration module

- SpecCompiler: validates PipelineSpec and compiles it into a RunGraph with step-level
  dependencies via topological sort
- RunnerManager: generates K8s Job manifests with run_id/step_id labels and injects
  RUN_ID, STEP_ID, STEP_RUN_ID, ATTEMPT, BUILDER env vars into containers
- RunOrchestrator: wires watchers → rule-engine → ai-supervisor → action-engine,
  manages PipelineRun/StepRun lifecycle, handles retries and run status transitions
- 27 new unit tests (102 total tests passing)
