# MVP

The MVP demonstrates end-to-end pipeline execution with real-time observation and policy-controlled intervention.

## Scope

### What works in MVP

1. **Pipeline definition via natural language** (simulated/planned)
   - Accept a text description of a build/test workflow
   - Generate a structured `PipelineSpec`
   - Compile spec into an executable `RunGraph`

2. **Kubernetes-based execution**
   - Schedule runner Jobs on the cluster
   - Execute build steps inside Jobs/Pods
   - Use Docker/BuildKit for image builds

3. **Real-time observation**
   - Watch Pod/Job status transitions
   - Stream and normalize Kubernetes events
   - Tail runner logs in real time

4. **Deterministic anomaly detection**
   - Rule engine detects stuck steps, repeated errors, resource pressure
   - Triggers AI supervisor for complex diagnosis

5. **Policy-controlled interventions**
   - Action engine executes a fixed set of allowed actions
   - All actions are gated against `specs/intervention-policy.yaml`
   - Every attempt is recorded

6. **Live run view**
   - UI shows current stage, step, events, and risk level
   - Action history and diagnosis summaries are visible

### What is out of scope for MVP

- Multi-team isolation and advanced RBAC
- External registry/cache integration
- Builder pool management (beyond basic selection)
- Guarded actions requiring human approval flow
- Full natural language parsing (stubbed/planned)

## Service Map for MVP

| Service | MVP Responsibility |
|---|---|
| `control-plane` | PipelineRun orchestration, RunGraph scheduling |
| `watcher` | Pod/Job/Event watching, log tailing, event normalization |
| `rule-engine` | Deterministic anomaly detection |
| `ai-supervisor` | Diagnosis summarization (stubbed) |
| `action-engine` | Policy-gated intervention execution |
| `ui` | Live run view |

## Success Criteria

- A pipeline spec can be submitted and executed as K8s Jobs
- Pod/Job transitions are observed and emitted as normalized events
- Rule engine fires on known anomaly patterns
- AI supervisor produces a diagnosis summary (stubbed is acceptable)
- Action engine can execute at least: rerun failed step, stop doomed run
- UI displays current run status and recent events
- All interventions are recorded in `InterventionRecord`
