---
"smart-cicd": minor
---

Add automated MiniMax AI PR review workflow

- GitHub Actions workflow triggered on PR open/synchronize/reopen
- review_pr.py: calls MiniMax API to analyze PR diff, posts review comments
- review-policy.md: codifies architecture boundary rules as enforceable policy
- review-prompt.md: system prompt for AI review behavior
