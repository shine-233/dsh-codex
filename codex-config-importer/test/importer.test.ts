import { describe, it, expect } from 'vitest';
import { parseTomlLite, tomlToCordisPatch } from '../src/dsh-plugin';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE = `
# comment
model = "gpt-5.6-codex"
model_provider = "openrouter"
approval_policy = "on-request"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
`;

describe('toml-lite importer', () => {
  it('parses scalars, booleans, tables', () => {
    const cfg = parseTomlLite(SAMPLE);
    expect(cfg.model).toBe('gpt-5.6-codex');
    expect(cfg.approval_policy).toBe('on-request');
    expect((cfg.model_providers as any).openrouter.base_url).toContain('openrouter');
  });
  it('emits cordis patch yaml', () => {
    const dir = mkdtempSync(join(tmpdir(),'ci-'));
    const f = join(dir,'config.toml'); writeFileSync(f,SAMPLE);
    const yml = tomlToCordisPatch(f);
    expect(yml).toContain('llm-route');
    expect(yml).toContain('https://openrouter.ai/api/v1');
    rmSync(dir,{recursive:true,force:true});
  });
  it('preserves commas and comments inside quoted values and parses inline tables', () => {
    const cfg = parseTomlLite(`tags = ["a,b", "#not-comment"] # trailing\nmeta = { region = "us-east", retries = 3 }`);
    expect(cfg.tags).toEqual(['a,b', '#not-comment']);
    expect(cfg.meta).toEqual({ region: 'us-east', retries: 3 });
  });
  it('parses escaped basic strings and numeric forms', () => {
    const cfg = parseTomlLite(`message = "line\\nnext"\nratio = 1.25e2`);
    expect(cfg.message).toBe('line\nnext');
    expect(cfg.ratio).toBe(125);
  });
  it('parses bare dotted keys relative to their table', () => {
    const cfg = parseTomlLite(`model_providers.openrouter.base_url = "https://openrouter.ai/api/v1"
[model_providers.openrouter]
auth.timeout_ms = 7000`);
    expect(cfg.model_providers.openrouter).toEqual({
      base_url: 'https://openrouter.ai/api/v1',
      auth: { timeout_ms: 7000 },
    });
  });
  it('accepts spaced and hyphenated dotted keys without prototype mutation', () => {
    const cfg = parseTomlLite(`model_providers . my-provider . base_url = "https://example.invalid/v1"
__proto__.polluted = true
safe.constructor.polluted = true
meta = { good.value = 1, prototype.polluted = true }`);
    expect(cfg.model_providers['my-provider'].base_url).toBe('https://example.invalid/v1');
    expect(cfg.meta).toEqual({ good: { value: 1 } });
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(cfg, '__proto__')).toBe(false);
    expect(cfg.safe).toBeUndefined();
  });
  it('emits the same provider patch from dotted and table syntax', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-dotted-'));
    const dotted = join(dir, 'dotted.toml');
    const table = join(dir, 'table.toml');
    writeFileSync(dotted, `model = "gpt-5.6-codex"\nmodel_provider = "openrouter"\nmodel_providers.openrouter.base_url = "https://openrouter.ai/api/v1"`);
    writeFileSync(table, `model = "gpt-5.6-codex"\nmodel_provider = "openrouter"\n[model_providers.openrouter]\nbase_url = "https://openrouter.ai/api/v1"`);
    expect(tomlToCordisPatch(dotted)).toBe(tomlToCordisPatch(table));
    rmSync(dir, { recursive: true, force: true });
  });
  it('parses a representative Codex config fixture without losing migration keys', () => {
    const fixture = readFileSync(fileURLToPath(new URL('./fixtures/codex-config.toml', import.meta.url)), 'utf8');
    const cfg = parseTomlLite(fixture);
    expect(cfg.model).toBe('gpt-5.6-codex');
    expect(cfg.enabled_features).toEqual(['shell', 'mcp', 'web_search']);
    expect(cfg.release_date).toBe('2026-09-07');
    expect(cfg.instructions).toContain('Use the repository instructions.');
    expect(cfg.instructions).toContain('Keep # markers inside multiline text.');
    expect(cfg.model_providers.openrouter.base_url).toBe('https://openrouter.ai/api/v1');
    expect(cfg.model_providers.openrouter.auth.timeout_ms).toBe(7000);
    expect(cfg.mcp_servers).toHaveLength(2);
    expect(cfg.mcp_servers[0]).toMatchObject({ name: 'local-tools', args: ['server.js', '--stdio'] });
    expect(cfg.mcp_servers[1]).toMatchObject({ name: 'remote-tools', url: 'https://example.invalid/mcp' });
  });
});
