# Vision

> Source pair:
> - English: ./vision.md
> - 中文: ../zh-CN/vision.md

Smart CI/CD is an AI-powered CI/CD platform that turns natural language build intent into executable, observable, and policy-controlled runtime workflows.

Instead of treating CI/CD as a static configuration problem, the platform treats it as a supervised execution system:
- users express what they want to build and verify
- the system compiles intent into structured execution plans
- Kubernetes runners and Docker/BuildKit perform execution
- runtime signals are observed continuously
- deterministic rules and AI-assisted diagnosis identify issues
- policy-controlled interventions help recover from failure safely

## Product Goal

The goal of the platform is to make build and test execution:
- easier to define
- easier to observe
- easier to diagnose
- safer to recover
- easier to evolve over time

## Guiding Principles

1. Natural language expresses intent
2. Structured specs define execution
3. Runtime actions are policy-gated
4. Separation of concerns

## Core Properties

- Kubernetes-native
- Build-engine centered
- AI-assisted supervision
- Safe by default
- Audit-friendly

## Non-goals

The system is not intended to be:
- a general-purpose chatbot
- an unbounded autonomous coding agent
- a default production deployment system
- a secret / IAM / RBAC management tool in its early phases
