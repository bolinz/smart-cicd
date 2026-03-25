// Core types for ai-supervisor

import type { RuntimeEvent } from '../watcher/types';
import type { ActionType } from '../control-plane/types';

export type DiagnosisSource = 'rule-engine' | 'ai-supervisor';

export interface DiagnosisRecord {
  id: string;
  runId: string;
  stepId?: string;
  source: DiagnosisSource;
  confidence: number; // 0-1
  summary: string;
  evidence: string[];
  rankedActions: RankedAction[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
}

export interface RankedAction {
  action: ActionType;
  score: number; // 0-1
  reason: string;
  parameters?: Record<string, unknown>;
}

export interface DiagnosisRequest {
  runId: string;
  stepId?: string;
  events: RuntimeEvent[];
  ruleResults: string[]; // rule result IDs that triggered escalation
  context?: Record<string, unknown>;
}

export interface DiagnosisResponse {
  record: DiagnosisRecord;
}
