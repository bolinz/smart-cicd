// AI Supervisor — read-only diagnosis and action ranking
//
// Receives escalated rule-engine results and raw runtime events,
// produces a DiagnosisRecord with ranked candidate actions.

import { v4 as uuid } from 'uuid';
import type { RuntimeEvent } from '../watcher/types.js';
import type { RuleResult } from '../rule-engine/types.js';
import type { ActionType } from '../control-plane/types.js';
import type { DiagnosisRecord, RankedAction } from './types.js';

// ─── Policy constants (mirrors specs/intervention-policy.yaml) ─────────────────

const POLICY_ALLOWED: ActionType[] = [
  'rerun-step',
  'clear-cache-and-rerun',
  'restart-runner-pod',
  'stop-run',
];

const POLICY_GUARDED: ActionType[] = [
  'increase-resources',
  'adjust-timeout',
];

// ─── Action scoring heuristics ─────────────────────────────────────────────────

interface ActionScore {
  action: ActionType;
  score: number; // 0–1
  reason: string;
  parameters?: Record<string, unknown>;
}

function scoreActions(
  ruleResults: RuleResult[],
  events: RuntimeEvent[],
): ActionScore[] {
  const scores: ActionScore[] = [];

  // Collect rule severities and messages
  const hasCritical = ruleResults.some((r) => r.severity === 'critical');
  const hasWarning = ruleResults.some((r) => r.severity === 'warning');
  const ruleNames = new Set(ruleResults.map((r) => r.rule));
  const latestMessage = ruleResults[0]?.message ?? '';

  // ── rerun-step ─────────────────────────────────────────────────────────────
  {
    let score = 0.5;
    let reason = 'Generic retry — use when a step fails or gets stuck';

    if (ruleNames.has('stuck-step') || ruleNames.has('repeated-error')) {
      score = 0.85;
      reason = 'Step appears stuck or repeating the same error; rerun may resolve transient issues';
    } else if (ruleNames.has('timeout-risk')) {
      score = 0.7;
      reason = 'Step running long; rerun with fresh state may help';
    } else if (hasCritical) {
      score = 0.6;
    }

    scores.push({ action: 'rerun-step', score, reason });
  }

  // ── clear-cache-and-rerun ──────────────────────────────────────────────────
  {
    let score = 0.3;
    let reason = 'Clears build cache then retries; higher latency but may fix corrupted cache';

    if (
      ruleNames.has('repeated-error') &&
      latestMessage.toLowerCase().includes('build')
    ) {
      score = 0.75;
      reason = 'Build error repeating; cache corruption suspected';
    } else if (ruleNames.has('resource-pressure')) {
      score = 0.6;
      reason = 'Resource pressure detected; cache clear + rerun with fresh resources';
    }

    scores.push({ action: 'clear-cache-and-rerun', score, reason });
  }

  // ── restart-runner-pod ─────────────────────────────────────────────────────
  {
    let score = 0.4;
    let reason = 'Deletes and recreates the runner pod; use for infrastructure-level failures';

    if (ruleNames.has('infra-failure') || ruleNames.has('scheduling-failure')) {
      score = 0.8;
      reason = 'Infrastructure failure detected; pod restart may recover';
    } else if (ruleNames.has('pull-backoff')) {
      score = 0.7;
      reason = 'Image pull issue; pod restart may retry with fresh image pull';
    } else if (
      ruleNames.has('stuck-step') &&
      events.some((e) => e.kind === 'PodPhaseChanged' && e.type === 'Running')
    ) {
      score = 0.65;
      reason = 'Pod is stuck running; restart may clear deadlocked state';
    }

    scores.push({ action: 'restart-runner-pod', score, reason });
  }

  // ── stop-run ───────────────────────────────────────────────────────────────
  {
    let score = 0.2;
    let reason = 'Cancels the entire pipeline run; use when recovery is not feasible';

    if (hasCritical && ruleResults.length >= 2) {
      score = 0.7;
      reason = 'Multiple critical rule violations; run is unlikely to succeed';
    } else if (ruleNames.has('infra-failure')) {
      // Only escalate to stop if infra failure is severe
      const infraResults = ruleResults.filter((r) => r.rule === 'infra-failure');
      if (infraResults.length >= 1) {
        const reasons = infraResults
          .map((r) => r.message)
          .join('; ');
        if (reasons.toLowerCase().includes('oomkilled') || reasons.toLowerCase().includes('evicted')) {
          score = 0.75;
          reason = `Severe infrastructure failure: ${reasons}. Run cannot be salvaged.`;
        }
      }
    }

    scores.push({ action: 'stop-run', score, reason });
  }

  // ── increase-resources (guarded) ────────────────────────────────────────────
  {
    let score = 0.2;
    let reason = 'Requests more CPU/memory for the runner pod; requires approval (guarded action)';

    if (ruleNames.has('resource-pressure') || ruleNames.has('timeout-risk')) {
      score = 0.6;
      reason = 'Resource pressure or timeout risk; additional resources may resolve';
    }

    scores.push({ action: 'increase-resources', score, reason, parameters: { resourceMultiplier: 2 } });
  }

  // ── adjust-timeout (guarded) ────────────────────────────────────────────────
  {
    let score = 0.15;
    let reason = 'Extends step timeout; requires approval (guarded action)';

    if (ruleNames.has('timeout-risk')) {
      score = 0.5;
      reason = 'Step approaching timeout; extending may allow completion';
    }

    scores.push({ action: 'adjust-timeout', score, reason, parameters: { timeoutMs: 300000 } });
  }

  return scores;
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function computeConfidence(ruleResults: RuleResult[], events: RuntimeEvent[]): number {
  if (ruleResults.length === 0) return 0.1;

  // More distinct rule types fired → higher confidence
  const distinctRules = new Set(ruleResults.map((r) => r.rule)).size;
  const ruleContribution = Math.min(distinctRules * 0.15, 0.45);

  // Critical severity adds confidence
  const hasCritical = ruleResults.some((r) => r.severity === 'critical');
  const severityContribution = hasCritical ? 0.3 : 0.1;

  // Having supporting events in the buffer adds credibility
  const recentEventCount = Math.min(events.length / 20, 0.25);

  return Math.min(ruleContribution + severityContribution + recentEventCount, 0.95);
}

// ─── Risk level derivation ────────────────────────────────────────────────────

function deriveRiskLevel(ruleResults: RuleResult[]): DiagnosisRecord['riskLevel'] {
  if (ruleResults.some((r) => r.severity === 'critical')) return 'critical';
  if (ruleResults.some((r) => r.severity === 'warning')) return 'high';
  return 'medium';
}

// ─── Summary generation ───────────────────────────────────────────────────────

function buildSummary(ruleResults: RuleResult[]): string {
  if (ruleResults.length === 0) return 'No specific rule violations detected.';

  const byRule = new Map<string, RuleResult[]>();
  for (const r of ruleResults) {
    const list = byRule.get(r.rule) ?? [];
    list.push(r);
    byRule.set(r.rule, list);
  }

  const parts: string[] = [];
  for (const [rule, results] of byRule) {
    const msgs = results.map((r) => r.message).join('; ');
    parts.push(`${rule}: ${msgs}`);
  }

  return parts.join(' | ');
}

// ─── Evidence aggregation ────────────────────────────────────────────────────

function aggregateEvidence(ruleResults: RuleResult[], events: RuntimeEvent[]): string[] {
  const evidence: string[] = [];

  // Include rule result evidence (already curated)
  for (const r of ruleResults) {
    evidence.push(...r.evidence.slice(0, 3));
  }

  // Add recent error/warning events if evidence is thin
  const recentErrors = events
    .filter((e) => e.severity === 'error' || e.severity === 'warning')
    .slice(-5);

  for (const e of recentErrors) {
    const entry = `[${e.source}] ${e.timestamp} — ${e.message}`;
    if (!evidence.includes(entry)) evidence.push(entry);
  }

  // Cap at 10 items
  return evidence.slice(0, 10);
}

// ─── Ranked actions ───────────────────────────────────────────────────────────

function rankActions(scores: ActionScore[]): RankedAction[] {
  const result: RankedAction[] = [];

  for (const s of scores) {
    // Filter forbidden actions (none in our set, but be explicit)
    const forbidden = ['deploy-production', 'modify-rbac', 'rotate-secrets'];
    if (forbidden.includes(s.action)) continue;

    // Deprioritize guarded actions slightly
    const isGuarded = POLICY_GUARDED.includes(s.action);
    const adjustedScore = isGuarded ? s.score * 0.8 : s.score;

    result.push({
      action: s.action,
      score: Math.round(adjustedScore * 100) / 100,
      reason: s.reason,
      parameters: s.parameters,
    });
  }

  // Sort descending by score
  result.sort((a, b) => b.score - a.score);

  return result;
}

// ─── Public factory ────────────────────────────────────────────────────────────

export interface AisSupervisorStub {
  diagnose(opts: {
    runId: string;
    stepId?: string;
    events: RuntimeEvent[];
    ruleResults: RuleResult[];
  }): Promise<DiagnosisRecord>;
}

/**
 * Creates an AI supervisor stub that performs read-only diagnosis.
 *
 * In the MVP this is a rule-based heuristic implementation.
 * It aggregates rule-engine results, derives risk, and ranks candidate actions
 * against the intervention policy without executing anything.
 */
export function createAisSupervisor(): AisSupervisorStub {
  return {
    async diagnose({ runId, stepId, events, ruleResults }): Promise<DiagnosisRecord> {
      const scores = scoreActions(ruleResults, events);
      const rankedActions = rankActions(scores);
      const confidence = computeConfidence(ruleResults, events);
      const riskLevel = deriveRiskLevel(ruleResults);
      const summary = buildSummary(ruleResults);
      const evidence = aggregateEvidence(ruleResults, events);

      return {
        id: uuid(),
        runId,
        stepId,
        source: 'ai-supervisor',
        confidence,
        summary,
        evidence,
        rankedActions,
        riskLevel,
        timestamp: new Date().toISOString(),
      };
    },
  };
}
