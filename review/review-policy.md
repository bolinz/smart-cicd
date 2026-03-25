# PR Review Policy

## Goal
Review pull requests for correctness, safety, architecture boundaries, and test coverage.

## Focus areas
1. Architecture boundary violations
2. Unsafe runtime actions
3. Missing tests for changed behavior
4. Policy violations
5. Suspicious broad refactors
6. Inconsistency with docs/specs

## Severity levels
- blocking: must be fixed before merge
- warning: should likely be fixed
- nit: optional improvement

## Blocking conditions
- changes widen automatic intervention scope without policy/spec updates
- watcher mixes in action logic
- ai-supervisor directly executes actions
- action-engine bypasses policy
- security boundary violations
- testable behavior changed with no tests added

## Output schema
Return JSON:
{
  "summary": "short review summary",
  "verdict": "approve|comment|request_changes",
  "findings": [
    {
      "severity": "blocking|warning|nit",
      "file": "path/to/file",
      "title": "short title",
      "detail": "specific explanation"
    }
  ]
}
