# Action Engine

The **only** component allowed to execute runtime interventions. Validates candidate actions against `specs/intervention-policy.yaml`, executes approved interventions, records attempts and outcomes, and enforces action limits.

## Allowed Actions (MVP)

- `rerun-step` — restart a failed step
- `clear-cache-and-rerun` — clear cache before rerunning
- `restart-runner-pod` — delete and recreate runner pod
- `stop-run` — cancel a doomed run

## Boundaries

- Must validate every action against policy before execution
- Must record every attempt in `InterventionRecord`
- Forbidden: modifying app source, production deployment, RBAC/IAM changes, secret rotation
