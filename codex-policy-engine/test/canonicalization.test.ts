import { describe, it, expect } from 'vitest';
import { canonicalizeCommandForApproval, parsePlainCommandScript } from '../src/canonicalization';
import { Policy } from '../src/policy';
import { prefixRule } from '../src/rule';
import { evaluateCached } from '../src/dsh-plugin';

describe('canonicalization (ported from core/src/command_canonicalization.rs, 0.153.4)', () => {
  it('unwraps a single plain sh -c command', () => {
    expect(canonicalizeCommandForApproval(['/bin/bash', '-lc', 'git status'])).toEqual(['git', 'status']);
  });
  it('keeps complex scripts in script-prefix form', () => {
    const out = canonicalizeCommandForApproval(['bash', '-c', 'echo hi; rm -rf /']);
    expect(out[0]).toBe('__codex_shell_script__');
    expect(out[1]).toBe('-c');
  });
  it('canonicalizes powershell -Command', () => {
    const out = canonicalizeCommandForApproval(['pwsh', '-Command', 'Get-ChildItem']);
    expect(out[0]).toBe('__codex_powershell_script__');
    expect(out[1]).toBe('Get-ChildItem');
  });
  it('passes non-wrapper commands through verbatim', () => {
    expect(canonicalizeCommandForApproval(['git', 'status'])).toEqual(['git', 'status']);
  });
  it('rejects scripts with dynamic words as non-plain', () => {
    expect(parsePlainCommandScript('echo $(rm -rf /)')).toBeNull();
    expect(parsePlainCommandScript('git status && npm test')).toEqual([['git', 'status'], ['npm', 'test']]);
  });
  it('wrapper-path differences share one approval-cache entry', () => {
    const p = new Policy();
    p.addPrefixRule(prefixRule('git', ['status'], 'Allow'));
    const cache = new Map();
    const a = evaluateCached(p, '/bin/bash -lc "git status"', cache);
    const b = evaluateCached(p, 'bash -c "git status"', cache);
    expect(a.decision).toBe(b.decision);
    expect(cache.size).toBe(1);
  });
});

import { BUILT_IN_PRESETS, presetById } from '../src/approvalPresets';
describe('approvalPresets (ported from utils/approval-presets, 0.153.4)', () => {
  it('exposes the three built-in presets', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual(['read-only', 'workspace', 'danger-full-access']);
    expect(presetById('workspace')?.approval).toBe('on-failure');
    expect(presetById('nope')).toBeNull();
  });
});
