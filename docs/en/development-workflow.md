# Development Workflow

> Source pair:
> - English: ./development-workflow.md
> - 中文: ../zh-CN/development-workflow.md

This document describes the local module-development loop and the handoff into release preparation, PR review, and next-module planning.

## Goals

The workflow should make module development:
- incremental
- reproducible
- reviewable
- local-first
- safe by default

## Local Module Loop

1. Set the current module in `.claude/state/current-module.json`
2. Implement exactly one scoped module
3. Run relevant tests
4. If tests pass, trigger `/module-complete`
5. `/module-complete` invokes:
   - `/release`
   - `/next-module`
6. Open a PR using the generated release draft
7. Let GitHub Actions run MiniMax PR review
8. If there are no blocking findings and repository rules allow it, enable auto-merge

## Current Module State

File:
- `.claude/state/current-module.json`

Example:
```json
{
  "module_name": "pod-watcher"
}
```

This file acts as the local source of truth for what module is currently being implemented.

## Skills

### `/release`
Used to:
- classify release type (`minor` or `patch`)
- prepare a changeset draft
- draft PR title and PR body

### `/next-module`
Used to:
- inspect the local repository
- determine the best next module
- return acceptance criteria
- generate a ready-to-run implementation prompt

### `/module-complete`
Used to:
- summarize completed module work
- call `/release`
- call `/next-module`
- produce the final handoff output for the current module

## Hook Automation

The local workflow uses Claude hooks.

### PostToolUse
When a test command completes successfully, record test status in:
- `.claude/state/test-status.json`

### TaskCompleted
When a task is completed:
- check current module state
- check the latest test status
- if both are valid, recommend running:
  - `/module-complete <module-name>`

## Recommended Development Pattern

For each module:
1. read docs and specs first
2. implement one bounded module
3. add or update tests
4. avoid cross-module scope expansion
5. finish with release preparation and next-step planning

## Release Handoff

Release in this project means:
- preparing a changeset
- drafting PR metadata
- entering the PR-based merge workflow

It does **not** mean:
- immediate version publishing
- immediate tag creation
- bypassing PR review

## PR Review Handoff

After a PR is opened:
- GitHub Actions fetches the PR diff
- MiniMax reviews the PR
- a structured review comment is posted
- if no blocking findings exist, auto-merge may be attempted

## Safety Rules

- Use local repository context first
- Do not widen intervention scope silently
- Do not bypass specs or policies
- Do not assume release means publishing has already happened
- Do not auto-start the next module without explicit confirmation
