// Core types for action-engine

import type { ActionType, PipelineRun } from '../control-plane/types';

export type ActionStatus = 'pending' | 'approved' | 'denied' | 'executing' | 'succeeded' | 'failed';

export interface InterventionRecord {
  id: string;
  runId: string;
  stepId?: string;
  triggerReason: string;
  actionType: ActionType;
  actionParameters: Record<string, unknown>;
  policyDecision: 'allowed' | 'denied' | 'guarded';
  executionResult?: ActionResult;
  timestamp: string;
  executedAt?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  effects?: Record<string, unknown>;
}

export interface CandidateAction {
  action: ActionType;
  parameters?: Record<string, unknown>;
  score: number;
  reason: string;
}

export interface InterventionRequest {
  runId: string;
  stepId?: string;
  candidate: CandidateAction;
  diagnosisId?: string;
}

export interface InterventionResponse {
  record: InterventionRecord;
}

export interface ActionLimits {
  maxAttemptsPerStep: number;
  maxInterventionsPerRun: number;
  resourceBumpLimit?: string;
  timeoutAdjustmentLimitMs?: number;
}
