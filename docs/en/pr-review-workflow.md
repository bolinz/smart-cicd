# PR Review Workflow

> Source pair:
> - English: ./pr-review-workflow.md
> - 中文: ../zh-CN/pr-review-workflow.md

## Flow

1. PR is opened or updated
2. GitHub Actions fetches PR diff
3. MiniMax reviews the diff
4. A structured review comment is posted
5. If there are no blocking findings, auto-merge is attempted

## Inputs

- PR title
- PR body
- changed files and patches
- review policy
- review prompt
