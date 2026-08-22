import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Policy, prefixRule, altsToken } from '../../codex-policy-engine/src/index';
import { parsePatch, applyPatch } from '../../codex-edit-fusion/src/index';
import { tomlToCordisPatch, parseTomlLite } from '../../codex-config-importer/src/tomlImporter';
import { parseRolloutText, toDshEvents, MemoryStore, listSessions } from '../../codex-session-kit/src/index';
import { catalogBudgetTokens, renderCatalog } from '../../codex-skills-kit/src/index';

describe('dsh-codex-pack end-to-end wiring (local repos)', () => {
  it('policy-engine gates command execution', () => {
    const p = new Policy();
    p.addPrefixRule(prefixRule('git', ['status'], 'Allow'));
    p.addPrefixRule({ first: 'npm', rest: [altsToken(['run']), altsToken(['test'])], decision: 'Allow' });
    expect(p.check(['git', 'status']).decision).toBe('Allow');
    expect(p.check(['npm', 'run', 'test']).decision).toBe('Allow');
    expect(p.check(['rm', '-rf', '/']).decision).toBe('Prompt');
  });

  it('edit-fusion applies a fuzzy v4a patch to a workspace file', () => {
    const files = new Map<string, string>([
      ['app.ts', 'const greeting = "hello";\nexport default greeting;\n'],
    ]);
    const patch = parsePatch([
      '*** Begin Patch',
      '*** Update File: app.ts',
      '@@',
      '-const greeting = "hello";',
      '+const greeting = "hello, dsh";',
      '*** End Patch',
    ].join('\n'));
    const res = applyPatch(patch, files);
    expect(res.errors).toEqual([]);
    expect(res.files.get('app.ts')).toContain('"hello, dsh"');
  });

  it('config-importer converts codex config.toml into a cordis patch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-e2e-cfg-'));
    const cfg = join(dir, 'config.toml');
    writeFileSync(cfg, [
      'model = "deepseek-chat"',
      'model_provider = "deepseek"',
      '[model_providers.deepseek]',
      'base_url = "https://api.deepseek.com"',
    ].join('\n'));
    const yml = tomlToCordisPatch(cfg);
    expect(yml).toBeTruthy();
    expect(yml).toContain('deepseek-chat');
    expect(parseTomlLite(readFileSync(cfg, 'utf8'))['model']).toBe('deepseek-chat');
  });

  it('session-kit imports a codex rollout and rebuilds memory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-e2e-sess-'));
    const rollout = join(dir, 'rollout-1.jsonl');
    writeFileSync(rollout, [
      JSON.stringify({ type: 'session_meta', payload: { id: 's1' } }),
      JSON.stringify({ type: 'user_message', payload: { message: 'hi' } }),
      JSON.stringify({ type: 'agent_message', payload: { message: 'hello' } }),
      'not-json-at-all',
    ].join('\n'));
    expect(listSessions(dir)).toHaveLength(1);
    const parsed = parseRolloutText(readFileSync(rollout, 'utf8'));
    expect(parsed.header?.payload?.id).toBe('s1');
    expect(parsed.badLines).toBe(1);
    expect(toDshEvents(parsed.items)).toHaveLength(2);

    const memPath = join(dir, 'memory.jsonl');
    const mem = new MemoryStore(memPath);
    mem.set('route', 'codex-port');
    expect(new MemoryStore(memPath).get('route')).toBe('codex-port');
  });

  it('skills-kit renders catalog under dsh context budget', () => {
    const budget = catalogBudgetTokens(128000);
    expect(budget).toBe(2560);
    const r = renderCatalog(
      [{ name: 'commit', description: 'git commit helper' }, { name: 'review', description: 'review helper' }],
      budget,
    );
    expect(r.included).toBe(2);
    expect(r.omitted).toBe(0);
    expect(r.text).toContain('- commit:');
  });
});
