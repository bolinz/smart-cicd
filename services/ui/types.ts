// Core types for ui

import type { PipelineRun, StepRun } from '../control-plane/types';
import type { RuntimeEvent } from '../watcher/types';
import type { DiagnosisRecord } from '../ai-supervisor/types';
import type { InterventionRecord } from '../action-engine/types';

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
