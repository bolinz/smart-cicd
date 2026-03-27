import { v4 as uuid } from 'uuid';
import type { PipelineSpec, RunGraph, GraphStep, ActionType } from './types.js';

/**
 * All action types are eligible for every step in the MVP.
 * In a later phase this would be constrained by step capabilities.
 */
const ALL_ELIGIBLE_ACTIONS: ActionType[] = [
  'rerun-step',
  'clear-cache-and-rerun',
  'restart-runner-pod',
  'stop-run',
  'increase-resources',
  'adjust-timeout',
];

export interface CompileResult {
  graph: RunGraph;
  errors: string[];
}

function topologicalSort(stageIds: string[], deps: Record<string, string[]>): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps[id] ?? []) {
      visit(dep);
    }
    result.push(id);
  }

  for (const id of stageIds) {
    visit(id);
  }
  return result;
}

/**
 * Validates a PipelineSpec and compiles it into a RunGraph.
 *
 * Validation rules:
 * - spec.id must be non-empty
 * - At least one stage with at least one step
 * - Stage IDs must be unique
 * - Step IDs must be unique across all stages
 * - dependsOn references must point to existing stage IDs
 * - No circular dependencies
 */
export function compileSpec(spec: PipelineSpec): CompileResult {
  const errors: string[] = [];

  if (!spec.id?.trim()) {
    errors.push('spec.id is required');
  }

  if (!spec.stages || spec.stages.length === 0) {
    errors.push('at least one stage is required');
  }

  const stageIds = new Set<string>();
  const stepIds = new Set<string>();
  const stepToStage = new Map<string, string>();

  for (const stage of spec.stages ?? []) {
    if (!stage.id?.trim()) {
      errors.push('stage.id is required');
      continue;
    }
    if (stageIds.has(stage.id)) {
      errors.push(`duplicate stage id: ${stage.id}`);
    }
    stageIds.add(stage.id);

    if (!stage.steps || stage.steps.length === 0) {
      errors.push(`stage ${stage.id} must have at least one step`);
    }

    for (const step of stage.steps ?? []) {
      if (!step.id?.trim()) {
        errors.push(`step.id is required in stage ${stage.id}`);
        continue;
      }
      if (stepIds.has(step.id)) {
        errors.push(`duplicate step id: ${step.id}`);
      }
      stepIds.add(step.id);
      stepToStage.set(step.id, stage.id);
    }

    for (const dep of stage.dependsOn ?? []) {
      if (!stageIds.has(dep) && !stepIds.has(dep)) {
        // We haven't seen this ID yet; could be a forward reference.
        // We re-check after all stages are processed.
      }
    }
  }

  // Build full dependency graph: stage dependsOn → stage ids
  const stageDeps: Record<string, string[]> = {};
  for (const stage of spec.stages ?? []) {
    stageDeps[stage.id] = stage.dependsOn ?? [];
  }

  // Check that all dependsOn references are valid
  for (const [stageId, deps] of Object.entries(stageDeps)) {
    for (const dep of deps) {
      if (!stageIds.has(dep)) {
        errors.push(`stage ${stageId} depends on unknown stage: ${dep}`);
      }
    }
  }

  // Check for circular dependencies via topological sort
  try {
    topologicalSort(Array.from(stageIds), stageDeps);
  } catch {
    errors.push(`circular dependency detected involving stages`);
  }

  if (errors.length > 0) {
    return { graph: { specId: spec.id, steps: [], dependencies: {} }, errors };
  }

  // Build step-level dependency graph
  // A step depends on all steps in stages that the current stage depends on
  const stepDeps: Record<string, string[]> = {};
  for (const stage of spec.stages ?? []) {
    const priorStepIds: string[] = [];
    for (const depStageId of stage.dependsOn ?? []) {
      const depStage = spec.stages?.find((s) => s.id === depStageId);
      for (const s of depStage?.steps ?? []) {
        priorStepIds.push(s.id);
      }
    }
    for (const step of stage.steps ?? []) {
      stepDeps[step.id] = priorStepIds;
    }
  }

  // Build GraphStep list
  const graphSteps: GraphStep[] = [];
  for (const stage of spec.stages ?? []) {
    for (const step of stage.steps ?? []) {
      graphSteps.push({
        id: step.id,
        stageId: stage.id,
        step,
        eligibleActions: ALL_ELIGIBLE_ACTIONS,
      });
    }
  }

  return {
    graph: {
      specId: spec.id,
      steps: graphSteps,
      dependencies: stepDeps,
    },
    errors: [],
  };
}
