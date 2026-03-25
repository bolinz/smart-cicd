# Architecture

## 1. Overview

This project is a Kubernetes-native agentic build platform.

It accepts natural language descriptions of build and test workflows, compiles them into structured execution plans, schedules runners on Kubernetes, executes builds with Docker/BuildKit, and supervises runtime behavior with AI-assisted monitoring and policy-controlled interventions.

The architecture is designed around four principles:

1. Natural language expresses intent.
2. Structured specs define execution.
3. Runtime actions are policy-gated.
4. Observation, diagnosis, and action are strictly separated.

---

## 2. System Goals

### Primary goals
- Convert natural language build requests into executable pipeline definitions
- Run builds and tests on Kubernetes-managed runners
- Use Docker/BuildKit as the core build engine
- Observe runs in real time through logs, events, and metrics
- Detect anomalies during execution
- Perform safe, policy-controlled interventions
- Produce structured, explainable, and auditable feedback

### Non-goals
- General-purpose chatbot behavior
- Unbounded autonomous code modification
- Production deployment automation by default
- Secret, IAM, or RBAC management in the MVP
- Replacing all CI/CD products in the first phase

---

## 3. High-Level Architecture

The system is divided into six major planes:

1. Intent Plane
2. Control Plane
3. Runner Plane
4. Observation Plane
5. Decision Plane
6. Action Plane

### 3.1 Intent Plane
Responsible for turning user intent into structured definitions.

Key responsibilities:
- accept natural language requests
- extract workflow intent
- generate `PipelineSpec`
- validate spec structure and policy compatibility

### 3.2 Control Plane
Responsible for orchestration and run lifecycle.

Key responsibilities:
- create and track `PipelineRun`
- compile `PipelineSpec` into execution graph
- schedule runner jobs
- coordinate watcher, rule-engine, AI supervisor, and action-engine
- persist run state and intervention history

### 3.3 Runner Plane
Responsible for executing build and test steps.

Key responsibilities:
- start Kubernetes Jobs/Pods
- prepare workspace
- run commands and tests
- invoke Docker/BuildKit for image builds
- emit logs and execution metadata

### 3.4 Observation Plane
Responsible for collecting runtime signals.

Key responsibilities:
- watch Pods and Jobs
- stream Kubernetes events
- tail logs
- collect metrics and traces
- normalize runtime signals into structured events

### 3.5 Decision Plane
Responsible for detecting anomalies and deciding what should happen next.

This plane is split into:
- deterministic rule-engine
- AI supervisor

### 3.6 Action Plane
Responsible for executing approved interventions.

Key responsibilities:
- validate actions against policy
- perform allowed interventions
- record action attempts and outcomes
- never bypass policy

---

## 4. Core Components

## 4.1 API / Intent Service
The entrypoint for users and external systems.

Responsibilities:
- accept natural language build requests
- accept structured run requests
- return run status and live updates
- expose run history and diagnosis summaries

Inputs:
- natural language request
- repository reference
- optional execution constraints

Outputs:
- `PipelineSpec`
- `PipelineRun`
- status handles for live view

---

## 4.2 Planner
Transforms user intent into structured execution.

Responsibilities:
- parse intent
- generate or update `PipelineSpec`
- infer common build/test stages
- apply defaults
- reject unsupported or unsafe requests

Constraints:
- must not directly execute commands
- must not bypass policy
- should preserve traceability from user intent to generated spec

---

## 4.3 Spec Compiler
Compiles structured definitions into executable runtime plans.

Responsibilities:
- validate `PipelineSpec`
- generate a DAG / ordered step graph
- attach retry rules
- attach observability hooks
- attach eligible intervention classes per step

Output:
- `RunGraph`

---

## 4.4 Run Orchestrator
The main coordinator for runtime execution.

Responsibilities:
- create `PipelineRun`
- schedule steps in order or by dependency
- submit runner Jobs to Kubernetes
- listen for step completion/failure
- hand off runtime signals to downstream systems
- trigger diagnosis and intervention workflows

Must not:
- make ad hoc unsafe action decisions
- execute actions directly outside action-engine

---

## 4.5 Runner Manager
Responsible for creating and tracking runner workloads.

Responsibilities:
- generate K8s Job specs
- assign labels and metadata
- inject workspace and runtime config
- attach run and step identifiers
- determine runner class
- manage retries at the orchestration layer

Typical labels:
- `run_id`
- `step_id`
- `pipeline_id`
- `runner_class`

---

## 4.6 Build Adapter
Responsible for interacting with Docker/BuildKit.

Responsibilities:
- execute image builds
- manage builder selection
- pass build parameters
- control cache usage
- capture build output and metadata

Notes:
- Docker/BuildKit is the core build engine
- Build execution should be abstracted behind an adapter
- build strategy should be swappable later without changing orchestration logic

---

## 4.7 Pod Watcher
Observes Pod lifecycle changes for controlled runs.

Responsibilities:
- monitor phase transitions
- monitor restart counts
- capture termination reasons
- associate Pod state with `run_id` and `step_id`
- emit normalized runtime events

Must not:
- diagnose causes
- trigger interventions directly

---

## 4.8 Job Watcher
Observes Kubernetes Job state.

Responsibilities:
- detect active/succeeded/failed transitions
- correlate Jobs to pipeline steps
- emit normalized events for scheduler and diagnosis systems

---

## 4.9 Event Watcher
Observes Kubernetes events for relevant resources.

Responsibilities:
- collect Warning and Normal events
- identify infrastructure-level signals
- normalize scheduling, pull, mount, health, and lifecycle issues

Examples of useful signals:
- failed scheduling
- image pull backoff
- unhealthy probe events
- failed mount
- eviction

---

## 4.10 Log Tailer
Streams runner logs for live monitoring.

Responsibilities:
- follow stdout/stderr
- tag logs with step/run identifiers
- support truncation and buffering
- emit normalized log events
- support reconnect after stream interruption

Must not:
- hold core run logic
- contain action decisions

---

## 4.11 Telemetry Collector
Collects structured metrics and traces.

Responsibilities:
- ingest runtime metrics
- ingest trace spans where available
- correlate metrics with runs and steps
- surface resource pressure and performance anomalies

---

## 4.12 Stream Normalizer
Converts heterogeneous runtime inputs into a unified event model.

Responsibilities:
- normalize logs, k8s events, metrics, and traces
- enforce event schema
- enrich with context
- forward normalized events downstream

Primary output:
- `RuntimeEvent`

---

## 4.13 Rule Engine
Performs deterministic runtime analysis.

Responsibilities:
- detect stuck conditions
- detect repeated error patterns
- detect likely infrastructure failures
- detect timeout risk
- detect resource pressure
- decide whether AI review should be triggered

Must not:
- execute actions
- infer unsafe permissions
- bypass policy

Preferred scope:
- fast
- deterministic
- low-cost
- explainable

---

## 4.14 AI Supervisor
Performs higher-level diagnosis and action ranking.

Responsibilities:
- summarize runtime state
- infer likely root causes
- distinguish infra failure from build failure
- rank candidate interventions
- explain current risk to the user

Must not:
- directly execute actions
- invent new action categories
- override policy

AI supervisor should be triggered selectively, not for every event.

---

## 4.15 Action Engine
The only component allowed to execute runtime interventions.

Responsibilities:
- validate candidate actions against policy
- execute approved interventions
- record action attempts
- record action results
- enforce action limits

Examples of allowed actions:
- rerun failed step
- clear cache then rerun
- restart runner pod
- stop obviously doomed run

Examples of guarded actions:
- increase resources
- adjust timeout
- reduce parallelism
- switch builder pool

Forbidden by default:
- modify app source
- deploy to production
- change RBAC or IAM
- rotate secrets

---

## 4.16 Live Run View Service
Provides real-time visibility into active runs.

Responsibilities:
- expose current stage
- expose active step
- expose recent key events
- expose current diagnosis
- expose action history
- expose risk level

The live view is a first-class product surface, not an afterthought.

---

## 5. Data Model

## 5.1 PipelineSpec
Represents the intended build workflow.

Typical contents:
- source repository
- ref
- stages
- execution image/runtime
- build targets
- retry policy
- observability options
- action policy references

This is the main translation target from natural language intent.

---

## 5.2 RunGraph
Represents the executable graph derived from `PipelineSpec`.

Contains:
- steps
- dependencies
- retry metadata
- observability requirements
- step capabilities
- intervention eligibility

---

## 5.3 PipelineRun
Represents one concrete execution of a pipeline.

Contains:
- run id
- current status
- current step
- timestamps
- overall risk level
- current attempt counts
- associated interventions

---

## 5.4 StepRun
Represents one concrete execution of a step.

Contains:
- step id
- run id
- runner pod/job reference
- status
- attempt number
- resource class
- start/end time

---

## 5.5 RuntimeEvent
The normalized event object used throughout the system.

Typical fields:
- `event_id`
- `run_id`
- `step_id`
- `timestamp`
- `source`
- `kind`
- `type`
- `severity`
- `message`
- `labels`
- `payload`

All runtime-critical observation data should flow through this schema.

---

## 5.6 InterventionRecord
Represents one attempted runtime action.

Contains:
- intervention id
- run id
- step id
- trigger reason
- action type
- action parameters
- policy decision
- execution result
- timestamps

---

## 5.7 DiagnosisRecord
Represents a diagnostic output from rule-engine or AI supervisor.

Contains:
- diagnosis id
- run id
- step id
- source
- confidence
- summary
- evidence
- ranked actions

---

## 6. Execution Flow

## 6.1 Normal Flow
1. User submits natural language request
2. Planner generates `PipelineSpec`
3. Spec Compiler produces `RunGraph`
4. Orchestrator creates `PipelineRun`
5. Runner Manager submits first Job
6. Observation Plane begins streaming signals
7. Step completes
8. Orchestrator advances to next step
9. Run completes successfully

## 6.2 Failure Flow
1. Step emits errors or abnormal signals
2. Observation Plane normalizes runtime data
3. Rule Engine classifies condition
4. AI Supervisor is triggered if needed
5. Candidate actions are produced
6. Action Engine validates against policy
7. Action is executed if allowed
8. Outcome is observed and verified
9. Orchestrator either resumes, retries, or marks failure

---

## 7. Intervention Model

Interventions are not arbitrary agent actions.
They are constrained runtime operations governed by policy.

### 7.1 Action Classes
- automatic actions
- guarded actions
- forbidden actions

### 7.2 Intervention Lifecycle
1. trigger detected
2. diagnosis generated
3. candidate action proposed
4. policy evaluated
5. action executed or denied
6. result recorded
7. verification performed

### 7.3 Intervention Limits
The system should enforce:
- max attempts per step
- max interventions per run
- resource bump limits
- timeout adjustment limits

---

## 8. Real-Time Supervision Model

Real-time supervision is a core feature.

The system should not wait until run completion to reason about failure.
Instead, it should continuously observe, detect, diagnose, and intervene where appropriate.

### 8.1 Signal Sources
- logs
- Kubernetes events
- Pod/Job status
- resource metrics
- trace signals
- build engine output

### 8.2 Detection Layers
1. raw signal collection
2. normalization
3. rule-based anomaly detection
4. AI-assisted diagnosis
5. action evaluation

### 8.3 Typical Real-Time Conditions
- no progress for N seconds
- repeated identical errors
- OOM/resource pressure
- pull backoff
- failed scheduling
- suspiciously long execution
- repeated failed retries with same cause

---

## 9. Kubernetes Topology

The system is Kubernetes-native and should use the cluster as the execution substrate.

### 9.1 Long-lived Services
- API / Intent Service
- Planner
- Orchestrator
- Watchers
- Rule Engine
- AI Supervisor
- Action Engine
- Live Run View Service

### 9.2 Short-lived Workloads
- runner Jobs
- optional transient helpers
- replay/testing Jobs where appropriate

### 9.3 Build Infrastructure
Build execution should use Docker/BuildKit through a dedicated build adapter.
Builder instances may be pooled and reused.

---

## 10. Security and Safety

This project is infrastructure-adjacent software and must default to least privilege.

### 10.1 Safety Principles
- policy before action
- explicit approval for guarded actions
- no hidden privilege escalation
- no direct secret mutation
- no production deployment by default
- no app source mutation by default

### 10.2 Runtime Safety
- all actions must be attributed
- all interventions must be recorded
- all policy denials should be visible
- dangerous operations must remain impossible unless intentionally enabled

---

## 11. Testing Strategy

This system requires more than unit testing.

### 11.1 Unit Tests
For:
- schema validation
- rule logic
- policy evaluation
- state transitions

### 11.2 Replay Tests
For:
- event streams
- log-driven failure detection
- intervention triggering
- repeated-error scenarios
- stuck detection

### 11.3 Integration Tests
For:
- orchestrator + watcher interaction
- runner lifecycle
- action execution boundaries
- live status propagation

### 11.4 Policy Tests
For:
- allowed actions
- denied actions
- guarded action handling
- intervention limits

---

## 12. Repository Responsibilities

Suggested service boundaries:

- `services/control-plane/`
- `services/watcher/`
- `services/rule-engine/`
- `services/ai-supervisor/`
- `services/action-engine/`
- `services/ui/`

Suggested supporting directories:
- `docs/`
- `specs/`
- `tests/unit/`
- `tests/integration/`
- `tests/replay/`
- `examples/`

---

## 13. Evolution Path

### Phase 1
- single-cluster MVP
- basic pipeline parsing
- runner Jobs
- Pod/Job/Event watchers
- log tailing
- deterministic anomaly detection
- limited interventions

### Phase 2
- richer AI diagnosis
- better live run view
- build cache optimization
- builder pool selection
- guarded actions with approval flow

### Phase 3
- multi-team isolation
- stronger policy model
- richer execution strategies
- advanced replay testing
- external integrations

---

## 14. Design Constraints

When implementing new features, preserve these constraints:

1. observation must remain separate from action
2. policy must remain separate from diagnosis
3. AI must not directly execute runtime actions
4. event shape must remain structured and stable
5. runtime-critical logic must be testable and replayable
6. architecture changes should be incremental

---

## 15. Open Questions

These are expected to evolve:
- final `PipelineSpec` shape
- builder pool design
- persistence backend choices
- tenancy model
- approval workflow for guarded actions
- trace/metric backend choices
- external registry/cache strategy

These questions should be resolved through specs and implementation tasks, not hidden in prompts.
