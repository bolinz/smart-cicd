// Core types for control-plane

export type RunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export interface PipelineSpec {
  id: string;
  sourceRepo: string;
  ref: string;
  stages: Stage[];
  runtime: RuntimeConfig;
  retryPolicy?: RetryPolicy;
}

export interface Stage {
  id: string;
  name: string;
  steps: Step[];
  dependsOn?: string[];
}

export interface Step {
  id: string;
  name: string;
  image: string;
  commands: string[];
  resourceClass?: string;
  timeout?: string;
}

export interface RuntimeConfig {
  builder: 'docker' | 'buildkit';
  executorImage: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface RunGraph {
  specId: string;
  steps: GraphStep[];
  dependencies: Record<string, string[]>;
}

export interface GraphStep {
  id: string;
  stageId: string;
  step: Step;
  eligibleActions: ActionType[];
}

export interface PipelineRun {
  id: string;
  specId: string;
  status: RunStatus;
  currentStepId?: string;
  startedAt?: string;
  finishedAt?: string;
  riskLevel: RiskLevel;
  attemptCounts: Record<string, number>;
}

export interface StepRun {
  id: string;
  runId: string;
  stepId: string;
  status: StepStatus;
  attemptNumber: number;
  podName?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ActionType =
  | 'rerun-step'
  | 'clear-cache-and-rerun'
  | 'restart-runner-pod'
  | 'stop-run'
  | 'increase-resources'
  | 'adjust-timeout';
