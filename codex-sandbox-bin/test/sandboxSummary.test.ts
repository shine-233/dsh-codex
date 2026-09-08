import { describe, it, expect } from 'vitest';
import { sandboxSummary, incrementCounter, diagnosticsSnapshot } from '../src/sandboxSummary.js';

describe('sandboxSummary + diagnostics (distilled from utils/sandbox-summary + diagnostics)', () => {
  it('summarizes the vendored binaries for this platform', () => {
    const s = sandboxSummary();
    expect(s.complete).toBe(true);
    if (process.platform === 'win32') {
      expect(s.binaries.map((b) => b.name)).toContain('codex-command-runner.exe');
    } else if (process.platform === 'linux') {
      expect(s.binaries.map((b) => b.name)).toContain('codex-linux-sandbox');
    }
  });
  it('diagnostics counters accumulate', () => {
    incrementCounter('tool_calls');
    incrementCounter('tool_calls', 2);
    expect(diagnosticsSnapshot().counters['tool_calls']).toBe(3);
  });
});
