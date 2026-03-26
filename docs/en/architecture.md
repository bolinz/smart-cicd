# Architecture

> Source pair:
> - English: ./architecture.md
> - 中文: ../zh-CN/architecture.md

## Overview

Smart CI/CD is a Kubernetes-native agentic build platform.

It converts build intent into structured execution plans, runs them on Kubernetes-managed runners, executes build steps with Docker/BuildKit, observes runtime signals continuously, and uses rule-based plus AI-assisted supervision to support safe, policy-controlled interventions.

The architecture is built around four invariants:

1. Natural language expresses intent
2. Structured specs define execution
3. Runtime actions are policy-gated
4. Observation, diagnosis, and action are strictly separated

## Architectural Layers

1. Intent Layer
2. Control Layer
3. Execution Layer
4. Observation Layer
5. Decision Layer
6. Action Layer

### Intent Layer
- accept natural language or structured requests
- produce or validate `PipelineSpec`

### Control Layer
- create and track `PipelineRun`
- compile `PipelineSpec` into `RunGraph`
- schedule work onto runners
- persist state and history

### Execution Layer
- launch runner Jobs/Pods
- prepare workspace and runtime
- execute commands and tests
- invoke Docker/BuildKit for builds

### Observation Layer
- watch Pods and Jobs
- stream Kubernetes events
- tail logs
- collect metrics and traces
- normalize runtime signals into `RuntimeEvent`

### Decision Layer
- Rule Engine for deterministic detection
- AI Supervisor for bounded diagnosis and action ranking

### Action Layer
- validate actions against policy
- execute allowed interventions
- record attempts and outcomes

## Core Runtime Components

- API / Intent Service
- Spec Compiler
- Run Orchestrator
- Runner Manager
- Build Adapter
- Watchers
- Stream Normalizer
- Rule Engine
- AI Supervisor
- Action Engine
- Live Run View Service

## Data Model

- `PipelineSpec`
- `RunGraph`
- `PipelineRun`
- `StepRun`
- `RuntimeEvent`
- `DiagnosisRecord`
- `InterventionRecord`

## Execution Flow

### Normal path
1. Request arrives
2. `PipelineSpec` is created or validated
3. `RunGraph` is compiled
4. `PipelineRun` is created
5. Runner Jobs are launched
6. Runtime signals are observed and normalized
7. Steps complete
8. Run completes successfully

### Failure path
1. A step emits abnormal signals
2. Observation layer produces normalized events
3. Rule Engine classifies known conditions
4. AI Supervisor is triggered when necessary
5. Candidate actions are ranked
6. Action Engine validates policy
7. Allowed action is executed
8. Outcome is verified
9. Run resumes, retries, or fails safely

## Security and Safety

- policy before action
- least privilege by default
- no hidden privilege escalation
- no production deployment by default
- no app-source mutation by default

## Evolution Path

### Phase 1
- single-cluster MVP
- basic spec submission
- runner Jobs
- watcher stack
- deterministic anomaly detection
- limited interventions

### Phase 2
- richer AI diagnosis
- stronger live run view
- better build/cache strategy
- guarded actions with approval flow

### Phase 3
- stronger tenancy model
- richer execution strategies
- advanced replay/testing system
- more external integrations
