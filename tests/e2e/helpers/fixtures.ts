/**
 * Test fixtures for e2e tests
 */

import type { PipelineSpec } from '../../../services/control-plane/types.js';

/**
 * Simple pass-through pipeline spec for happy path testing
 */
export function makeSimpleSpec(overrides?: Partial<PipelineSpec>): PipelineSpec {
  return {
    id: `e2e-test-${Date.now()}`,
    sourceRepo: 'https://github.com/test/simple-repo',
    ref: 'main',
    stages: [
      {
        id: 'build-stage',
        name: 'Build',
        steps: [
          {
            id: 'build',
            name: 'Build',
            image: 'alpine:latest',
            commands: ['echo hello world'],
          },
        ],
      },
    ],
    runtime: { builder: 'docker', executorImage: 'alpine:latest' },
    ...overrides,
  };
}

/**
 * Multi-stage pipeline spec
 */
export function makeMultiStageSpec(overrides?: Partial<PipelineSpec>): PipelineSpec {
  return {
    id: `e2e-multistage-${Date.now()}`,
    sourceRepo: 'https://github.com/test/multistage-repo',
    ref: 'main',
    stages: [
      {
        id: 'build-stage',
        name: 'Build',
        steps: [
          {
            id: 'build',
            name: 'Build',
            image: 'alpine:latest',
            commands: ['echo building...', 'sleep 1', 'echo done'],
          },
        ],
      },
      {
        id: 'test-stage',
        name: 'Test',
        dependsOn: ['build-stage'],
        steps: [
          {
            id: 'test',
            name: 'Test',
            image: 'alpine:latest',
            commands: ['echo testing...', 'echo tests passed'],
          },
        ],
      },
    ],
    runtime: { builder: 'docker', executorImage: 'alpine:latest' },
    ...overrides,
  };
}

/**
 * Pipeline spec that will trigger OOMKilled - low memory limit
 */
export function makeOOMKillingSpec(overrides?: Partial<PipelineSpec>): PipelineSpec {
  return {
    id: `e2e-oom-${Date.now()}`,
    sourceRepo: 'https://github.com/test/oom-repo',
    ref: 'main',
    stages: [
      {
        id: 'mem-test-stage',
        name: 'Memory Test',
        steps: [
          {
            id: 'mem-test',
            name: 'Memory Test',
            image: 'alpine:latest',
            resourceClass: 'small', // Low memory limit
            commands: [
              // Try to allocate more memory than the limit
              'echo "Allocating memory..."',
              // This will OOM kill on small resource class
              'cat /proc/meminfo | head -5',
            ],
          },
        ],
      },
    ],
    runtime: { builder: 'docker', executorImage: 'alpine:latest' },
    ...overrides,
  };
}

/**
 * Pipeline spec that always fails
 */
export function makeFailingSpec(overrides?: Partial<PipelineSpec>): PipelineSpec {
  return {
    id: `e2e-failing-${Date.now()}`,
    sourceRepo: 'https://github.com/test/failing-repo',
    ref: 'main',
    stages: [
      {
        id: 'fail-stage',
        name: 'Fail',
        steps: [
          {
            id: 'fail',
            name: 'Fail',
            image: 'alpine:latest',
            commands: ['echo "Intentional failure"', 'exit 1'],
          },
        ],
      },
    ],
    runtime: { builder: 'docker', executorImage: 'alpine:latest' },
    ...overrides,
  };
}

/**
 * Pipeline spec with retry policy for flake testing
 */
export function makeRetryableFailureSpec(overrides?: Partial<PipelineSpec>): PipelineSpec {
  return {
    id: `e2e-retry-${Date.now()}`,
    sourceRepo: 'https://github.com/test/retry-repo',
    ref: 'main',
    stages: [
      {
        id: 'flake-stage',
        name: 'Flake Test',
        steps: [
          {
            id: 'flake',
            name: 'Flake Test',
            image: 'alpine:latest',
            commands: [
              // First attempt fails, second succeeds
              'if [ ! -f /tmp/attempted ]; then touch /tmp/attempted && exit 1; fi',
              'echo "Second attempt succeeded"',
            ],
          },
        ],
      },
    ],
    runtime: { builder: 'docker', executorImage: 'alpine:latest' },
    retryPolicy: { maxAttempts: 3, backoffMs: 100 },
    ...overrides,
  };
}

/**
 * Pipeline spec that runs for a long time (for timeout testing)
 */
export function makeLongRunningSpec(durationSeconds: number = 30, overrides?: Partial<PipelineSpec>): PipelineSpec {
  return {
    id: `e2e-long-${Date.now()}`,
    sourceRepo: 'https://github.com/test/long-repo',
    ref: 'main',
    stages: [
      {
        id: 'long-stage',
        name: 'Long Running',
        steps: [
          {
            id: 'long',
            name: 'Long Running',
            image: 'alpine:latest',
            timeout: '60s',
            commands: [`sleep ${durationSeconds}`, 'echo "Long running task complete"'],
          },
        ],
      },
    ],
    runtime: { builder: 'docker', executorImage: 'alpine:latest' },
    ...overrides,
  };
}

/**
 * Generate a unique test ID
 */
export function generateTestId(prefix: string = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
