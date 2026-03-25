---
"smart-cicd": patch
---

fix(tooling): handle missing/invalid MINIMAX_API_KEY gracefully in PR review script

- Check API key is non-empty before calling MiniMax API
- Handle API error responses and unexpected shapes with clear error messages
- Post descriptive comment on PR instead of crashing on KeyError
- EnvironmentError exits gracefully; other errors exit with failure but post a comment
