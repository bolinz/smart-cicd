# Vision

An AI-powered CI/CD platform that accepts natural language build requests, executes them on Kubernetes with Docker/BuildKit, observes runtime behavior in real time, and performs policy-controlled interventions when things go wrong.

## Guiding Principles

1. **Natural language expresses intent** — users describe what they want, not how to build it
2. **Structured specs define execution** — intent is compiled into deterministic pipeline definitions
3. **Runtime actions are policy-gated** — interventions never bypass defined policy
4. **Separation of concerns** — observation, diagnosis, and action are handled by distinct components

## Core Properties

- **Kubernetes-native** — runs as a set of long-lived services, uses K8s Jobs/Pods for execution
- **AI-assisted supervision** — AI helps diagnose failures and rank candidate interventions
- **Safe by default** — production deployment and privileged actions require explicit enablement
- **Audit-friendly** — every action is attributed, recorded, and explainable
