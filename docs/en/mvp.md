# MVP

> Source pair:
> - English: ./mvp.md
> - 中文: ../zh-CN/mvp.md

The MVP proves that Smart CI/CD can execute a pipeline end-to-end on Kubernetes, observe it in real time, detect common failure conditions, and perform a small set of safe, policy-controlled interventions.

## MVP Objective

The MVP is not meant to demonstrate full autonomy.  
It is meant to validate the core execution and supervision loop:

**spec submission -> run orchestration -> runtime observation -> anomaly detection -> diagnosis -> safe intervention -> live visibility**

## In Scope

### 1. Structured pipeline submission
- Accept a structured `PipelineSpec`
- Validate and compile it into an executable `RunGraph`

### 2. Kubernetes-based execution
- Schedule runner Jobs on Kubernetes
- Execute steps in Jobs/Pods
- Use Docker/BuildKit for build/image steps

### 3. Real-time observation
- Watch Pod and Job lifecycle transitions
- Stream and normalize Kubernetes events
- Tail runner logs in real time
- Produce normalized `RuntimeEvent` objects

### 4. Deterministic anomaly detection
- Detect stuck steps
- Detect repeated error patterns
- Detect basic resource pressure / infrastructure failure signals
- Trigger diagnosis workflow when needed

### 5. Policy-controlled interventions
- Execute a fixed set of allowed actions
- Validate all actions against `specs/intervention-policy.yaml`
- Record every intervention attempt and result

### 6. Live run visibility
- Show current run/stage/step
- Show recent events and current risk level
- Show action history and diagnosis summaries

## Out of Scope

The MVP does not include:
- advanced multi-team isolation
- advanced RBAC / approval workflows
- full natural-language parsing as a required entrypoint
- full builder-pool management
- external cache / registry optimization as a core requirement
- production deployment automation
- autonomous business-logic modification

## MVP Services

| Service | Responsibility in MVP |
|---|---|
| `control-plane` | Run orchestration and RunGraph scheduling |
| `watcher` | Pod/Job/Event watching, log tailing, event normalization |
| `rule-engine` | Deterministic anomaly detection |
| `ai-supervisor` | Diagnosis summarization and candidate-action ranking, initially limited or stubbed |
| `action-engine` | Policy-gated intervention execution |
| `ui` | Live run view |

## Required Interventions in MVP

The MVP should support at least:
- rerun failed step
- stop obviously doomed run

Optional but useful:
- clear cache then rerun

## Success Criteria

1. A `PipelineSpec` can be submitted and compiled into a `RunGraph`
2. A run can execute as Kubernetes Jobs
3. Pod/Job/Event/log signals are emitted as normalized runtime events
4. The rule engine detects at least one known anomaly type reliably
5. The action engine can execute at least two allowed interventions safely
6. The UI can display live status and recent events
7. Every intervention is recorded
8. AI-assisted diagnosis can produce a bounded summary, even if initially simplified
