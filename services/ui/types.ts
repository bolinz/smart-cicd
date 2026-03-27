// Core types for ui

import type { PipelineRun, StepRun } from '../control-plane/types.js';
import type { RuntimeEvent } from '../watcher/types.js';
import type { DiagnosisRecord } from '../ai-supervisor/types.js';
import type { InterventionRecord } from '../action-engine/types.js';

export interface RunView {
  run: PipelineRun;
  currentStep?: StepRun;
  recentEvents: RuntimeEvent[];
  currentDiagnosis?: DiagnosisRecord;
  actionHistory: InterventionRecord[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface RunSummary {
  id: string;
  status: PipelineRun['status'];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  startedAt?: string;
  finishedAt?: string;
  stepCount: number;
  completedSteps: number;
}
