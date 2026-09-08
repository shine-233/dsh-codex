import { describe, expect, it, vi } from 'vitest';
import { apply, evaluateCached, policyFromConfig } from '../src/dsh-plugin';
import type { Evaluation } from '../src/decision';
import { Policy } from '../src/policy';

type Interceptor = (
  exec: { name?: unknown; arguments?: unknown },
  next: () => unknown,
) => unknown

// Regression guards for the canonical approval cache. The cache is keyed on the
// canonicalized command (`/bin/bash -lc X` and `bash -lc X` share one entry), so
// wrapper-path differences must not re-run Policy.check().
describe('approval cache during interception', () => {
  it('uses the canonical approval cache during interception', () => {
    let interceptor: Interceptor | undefined
    const check = vi.spyOn(Policy.prototype, 'check')
    try {
      apply({
        on: (_event, handler) => { interceptor = handler as Interceptor },
      }, {
        mode: 'enforce',
        rules: [{ first: 'echo', decision: 'Allow' }],
      })
      const next = vi.fn(() => 'continued')

      expect(interceptor!({ name: 'bash', arguments: { command: 'echo hi' } }, next)).toBe('continued')
      expect(interceptor!({ name: 'bash', arguments: { command: 'echo hi' } }, next)).toBe('continued')
      expect(check).toHaveBeenCalledTimes(1)
    } finally {
      check.mockRestore()
    }
  })

  it('shares cached evaluations across equivalent shell wrappers', () => {
    const policy = policyFromConfig({ rules: [{ first: 'echo', decision: 'Allow' }] })
    const cached: Evaluation = { decision: 'Forbidden', matchedPrograms: ['cached'] }
    const cache = new Map<string, Evaluation>([['echo hi', cached]])

    expect(evaluateCached(policy, '/bin/bash -lc "echo hi"', cache)).toBe(cached)
  })
})
