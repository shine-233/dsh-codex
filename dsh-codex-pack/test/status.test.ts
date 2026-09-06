import { describe, it, expect } from 'vitest';
import { loadLedger, summarizeByModule, statusReport, pendingAdmissions } from '../src/index';

const fixture = {
  meta: { anchor_commit: '970b7f2ff4f6', upstream: 'openai/codex' },
  entries: [
    { path: 'a', lines: 100, dest: 'mod-x', status: 'implemented' },
    { path: 'b', lines: 200, dest: 'mod-x', status: 'distilled' },
    { path: 'c', lines: 300, dest: 'mod-y', status: 'design-only' },
    { path: 'new-thing', lines: 50, dest: 'EXCLUDED', code: 'E0-pending-admission' },
  ],
};

describe('dsh-codex-pack ledger health tool', () => {
  it('rolls up status per dest module', () => {
    const s = summarizeByModule(fixture as any);
    const x = s.find((m) => m.dest === 'mod-x')!;
    expect(x.implemented).toBe(1);
    expect(x.distilled).toBe(1);
    expect(x.upstreamLines).toBe(300);
  });
  it('lists pending admissions', () => {
    expect(pendingAdmissions(fixture as any).map((e) => e.path)).toEqual(['new-thing']);
  });
  it('renders a human-readable report', () => {
    const report = statusReport(fixture as any);
    expect(report).toContain('anchor: 970b7f2ff4f6');
    expect(report).toContain('mod-x: 已实现 1 · 蒸馏 1 · 仅设计 0 (上游 300 行)');
    expect(report).toContain('待准入 (E0): new-thing');
  });
  it('loadLedger rejects missing files', () => {
    expect(() => loadLedger('Z:/definitely/not/here.json')).toThrow(/ledger not found/);
  });
});
