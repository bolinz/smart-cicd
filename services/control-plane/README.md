# Control Plane

Orchestrates pipeline run lifecycle: creates `PipelineRun`, compiles `PipelineSpec` into `RunGraph`, schedules runner Jobs, and coordinates watcher/rule-engine/AI-supervisor/action-engine.

## Boundaries

- Only orchestrates; does not observe, diagnose, or execute actions directly
- Must not bypass intervention policy
- All run state mutations go through here
