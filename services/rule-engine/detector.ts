import type { RuleResult, RuleEvaluator, DetectionContext } from './types.js';
import {
  stuckStepRule,
  repeatedErrorRule,
  infraFailureRule,
  timeoutRiskRule,
  resourcePressureRule,
  pullBackoffRule,
  schedulingFailureRule,
} from './rules.js';

/** All rule evaluators, evaluated in order */
const ALL_RULES: RuleEvaluator[] = [
  stuckStepRule,
  repeatedErrorRule,
  infraFailureRule,
  resourcePressureRule,
  schedulingFailureRule,
  pullBackoffRule,
  timeoutRiskRule,
];

/**
 * Run all rules against the given context.
 * Deduplicates results: if the same rule fires multiple times,
 * only the first result per rule is kept.
 */
export function evaluateAllRules(ctx: DetectionContext): RuleResult[] {
  const results: RuleResult[] = [];
  const seen = new Set<string>();

  for (const rule of ALL_RULES) {
    const result = rule(ctx);
    if (result === null) continue;

    // Deduplicate by rule name
    if (seen.has(result.rule)) continue;
    seen.add(result.rule);

    results.push(result);
  }

  return results;
}

/**
 * Filter results that should escalate to AI supervisor.
 */
export function escalateResults(results: RuleResult[]): RuleResult[] {
  return results.filter((r) => r.shouldEscalate);
}
