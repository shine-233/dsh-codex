import { describe, it, expect } from 'vitest';
import { parseTomlLite, tomlToCordisPatch } from '../src/tomlImporter';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});
