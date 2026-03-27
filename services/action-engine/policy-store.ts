// Loads and parses intervention-policy.yaml

import { readFileSync } from 'fs';
import { join } from 'path';
import type { ActionType } from '../control-plane/types.js';
import type { ActionLimits } from './types.js';

// YAML is small and well-structured — manual parsing is acceptable for MVP
// In production, use js-yaml or a similar library

interface RawPolicy {
  allowed?: string[];
  guarded?: string[];
  forbidden?: string[];
  limits?: {
    maxAttemptsPerStep?: number;
    maxInterventionsPerRun?: number;
    resourceBumpLimit?: string;
    timeoutAdjustmentLimitMs?: number;
  };
}

function parseYamlPolicy(content: string): RawPolicy {
  const result: RawPolicy = {
    allowed: [],
    guarded: [],
    forbidden: [],
    limits: {},
  };

  const lines = content.split('\n');
  let currentSection: keyof RawPolicy | null = null;
  let inLimits = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for section headers
    if (trimmed === 'allowed:') {
      currentSection = 'allowed';
      inLimits = false;
      continue;
    }
    if (trimmed === 'guarded:') {
      currentSection = 'guarded';
      inLimits = false;
      continue;
    }
    if (trimmed === 'forbidden:') {
      currentSection = 'forbidden';
      inLimits = false;
      continue;
    }
    if (trimmed === 'limits:') {
      currentSection = null;
      inLimits = true;
      continue;
    }

    // Parse list items (e.g., "  - rerun-step")
    if (currentSection && trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      const arr = result[currentSection] as string[];
      arr.push(value);
      continue;
    }

    // Parse limit key-value pairs (e.g., "  maxAttemptsPerStep: 3")
    if (inLimits && trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      // Strip surrounding quotes if present (e.g., "2x" → 2x)
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (result.limits) {
        if (key === 'maxAttemptsPerStep' || key === 'maxInterventionsPerRun' || key === 'timeoutAdjustmentLimitMs') {
          (result.limits as Record<string, unknown>)[key] = parseInt(value, 10);
        } else {
          (result.limits as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  return result;
}

export class PolicyStore {
  private readonly policy: RawPolicy;

  constructor(policyPath?: string) {
    const path = policyPath ?? join(process.cwd(), 'specs', 'intervention-policy.yaml');
    const content = readFileSync(path, 'utf-8');
    this.policy = parseYamlPolicy(content);
  }

  isAllowed(action: ActionType): boolean {
    return this.policy.allowed?.includes(action) ?? false;
  }

  isGuarded(action: ActionType): boolean {
    return this.policy.guarded?.includes(action) ?? false;
  }

  /**
   * Checks if an action (including non-ActionType strings like 'deploy-production')
   * is forbidden by policy.
   */
  isForbidden(action: string): boolean {
    return this.policy.forbidden?.includes(action) ?? false;
  }

  getLimits(): ActionLimits {
    return {
      maxAttemptsPerStep: this.policy.limits?.maxAttemptsPerStep ?? 3,
      maxInterventionsPerRun: this.policy.limits?.maxInterventionsPerRun ?? 5,
      resourceBumpLimit: this.policy.limits?.resourceBumpLimit,
      timeoutAdjustmentLimitMs: this.policy.limits?.timeoutAdjustmentLimitMs,
    };
  }
}
