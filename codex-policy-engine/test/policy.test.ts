import { describe, it, expect } from 'vitest';
import { Policy } from '../src/index';
import { prefixRule, altsToken } from '../src/index';

describe('Policy (ported from execpolicy policy.rs)', () => {
  it('prefix rule with literal args allows matching command', () => {
    const p = new Policy();
    p.addPrefixRule(prefixRule('git', ['status'], 'Allow'));
    expect(p.check(['git', 'status']).decision).toBe('Allow');
    expect(p.check(['git', 'status', '--short']).decision).toBe('Allow');
    expect(p.check(['git', 'push']).decision).toBe('Prompt');
  });
  it('alts token accepts any listed alternative', () => {
    const p = new Policy();
    p.addPrefixRule({ first: 'npm', rest: [altsToken(['run','exec']), altsToken(['test','build'])], decision: 'Allow' });
    expect(p.check(['npm','run','test']).decision).toBe('Allow');
    expect(p.check(['npm','exec','build']).decision).toBe('Allow');
    expect(p.check(['npm','install']).decision).toBe('Prompt');
  });
  it('safest-first aggregation across multiple matches', () => {
    const p = new Policy();
    p.addPrefixRule(prefixRule('git', [], 'Allow'));
    p.addPrefixRule(prefixRule('git', ['push'], 'Forbidden'));
    expect(p.check(['git','push','origin']).decision).toBe('Forbidden');
  });
  it('heuristic fallback fires only when no rule matches', () => {
    const p = new Policy();
    p.addPrefixRule(prefixRule('ls', [], 'Allow'));
    const seen: string[] = [];
    const ev = p.check(['rm','-rf'], (c) => { seen.push(c.join(' ')); return 'Forbidden'; });
    expect(ev.decision).toBe('Forbidden');
    expect(seen).toEqual(['rm -rf']);
    expect(p.check(['ls']).matchedPrograms).toEqual(['ls']);
  });
  it('network allow/deny upsert semantics', () => {
    const p = new Policy();
    p.allowNetwork('example.com'); p.allowNetwork('example.com'); p.denyNetwork('example.com');
    expect(p.allowedDomains()).toEqual([]);
    expect(p.deniedDomains()).toEqual(['example.com']);
  });
  it('mergeOverlay combines base and overlay rules', () => {
    const base = new Policy(); base.addPrefixRule(prefixRule('git',['status'],'Allow'));
    const ov = new Policy(); ov.addPrefixRule(prefixRule('cargo',['build'],'Allow'));
    const m = base.mergeOverlay(ov);
    expect(m.check(['git','status']).decision).toBe('Allow');
    expect(m.check(['cargo','build']).decision).toBe('Allow');
  });
});
