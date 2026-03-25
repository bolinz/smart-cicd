# AI Supervisor

Performs higher-level diagnosis and ranks candidate intervention actions. Triggered selectively by the rule engine. Produces `DiagnosisRecord`s with ranked action candidates.

## Boundaries

- Only diagnoses and ranks; does not execute actions
- Must not invent new action categories or override policy
- Triggered selectively, not for every event
