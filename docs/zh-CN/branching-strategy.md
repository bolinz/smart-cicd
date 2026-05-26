# Branching Strategy

> Source pair:
> - English: ../en/branching-strategy.md
> - 中文: ./branching-strategy.md

## Overview

Smart CI/CD uses a lightweight GitHub Flow with structured branch naming. The model is designed for a single-team, single-repo setup with automated CI/CD.

## Branch Naming

| Pattern | Purpose | Base | Lifespan |
|---------|---------|------|----------|
| `main` | Production-ready code | — | Permanent |
| `feat/<name>` | New features | `main` | Short-lived |
| `fix/<name>` | Bug fixes | `main` | Short-lived |
| `chore/<name>` | Maintenance (deps, config, refactor) | `main` | Short-lived |
| `docs/<name>` | Documentation changes | `main` | Short-lived |
| `release/*` | Release preparation (auto-managed by changesets) | `main` | Temporary |

## Rules

### main
- Protected — requires PR + 1 review
- Requires CI checks (typecheck + test) to pass
- Direct push is forbidden
- Linear history recommended (merge with squash or rebase)

### Feature / Fix / Chore / Docs
- Branch from `main`
- Must be up to date with `main` before merging
- Naming: `<type>/<kebab-case-description>` (e.g., `feat/ai-supervisor-diagnosis`, `fix/hardcoded-namespace`)
- Merge back to `main` via PR

### Release
- Managed by Changesets — created and updated automatically when `.changeset/` files are detected
- PR title: `chore: version packages`
- Merged to trigger GitHub Release

## Workflow

```mermaid
graph LR
    A[main] -->|branch| B[feat/xxx]
    B -->|PR + review + CI| A
    A -->|changeset| C[release/*]
    C -->|PR + CI| A
    A -->|tag| D[GitHub Release]
```

## Cleanup

- Delete local branches after they are merged
- Prune remote tracking refs periodically: `git remote prune origin`
- Keep `main` clean — rebase or squash merge to avoid unnecessary merge commits

## CI/CD Pipeline

Every PR triggers:
1. **MiniMax PR Review** — AI code review
2. **CI** — TypeScript typecheck + vitest unit/integration tests
3. **Docker** — Build all 10 service images (no push on PR)

Push to `main` additionally:
- Pushes Docker images to ghcr.io
- Triggers Release workflow if `.changeset/` files changed
