# Rule Engine

Performs deterministic runtime analysis on normalized `RuntimeEvent`s. Detects stuck conditions, repeated error patterns, infrastructure failures, timeout risks, and resource pressure. Decides whether to escalate to AI supervisor.

## Boundaries

- Only detects; does not diagnose deeply or execute actions
- Fast, deterministic, low-cost, explainable
- Must not bypass policy or infer unsafe permissions
