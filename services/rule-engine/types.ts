// Core types for rule-engine

import type { RuntimeEvent } from '../watcher/types.js';

export type RuleName =
  | 'stuck-step'
  | 'repeated-error'
  | 'infra-failure'
  | 'timeout-risk'
  | 'resource-pressure'
  | 'pull-backoff'
  | 'scheduling-failure';

export type RuleSeverity = 'warning' | 'critical';

export interface RuleResult {
  rule: RuleName;
  severity: RuleSeverity;
  runId: string;
  stepId?: string;
  message: string;
  evidence: string[];
  shouldEscalate: boolean;
  timestamp: string;
}

export interface DetectionContext {
  events: RuntimeEvent[];
  stepRunId?: string;
  runId: string;
}

export type RuleEvaluator = (ctx: DetectionContext) => RuleResult | null;
