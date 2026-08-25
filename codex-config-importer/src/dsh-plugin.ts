// dsh plugin entry for codex-config-importer (codex config.toml -> cordis.patch.yml)
import { join } from 'node:path';
import { homedir } from 'node:os';
import { tomlToCordisPatch } from './tomlImporter.js';

export const name = 'codex-config-importer'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const cfg = config && typeof config === 'object' ? config : {}
  const defineTool = (d) => d
  ctx.tools.register(defineTool({
    name: 'codex_config_import',
    description: 'Read an openai/codex config.toml and emit an equivalent dsh cordis.patch.yml overlay (llm route + provider wiring). Read-only: returns YAML text.',
    parameters: {
      configPath: { type: 'string', description: 'path to codex config.toml; defaults to ~/.codex/config.toml' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const p = String(args?.configPath ?? join(homedir(), '.codex', 'config.toml'))
      const yml = tomlToCordisPatch(p)
      if (!yml) return JSON.stringify({ error: `config not found or nothing to migrate: ${p}` })
      return yml
    },
    timeoutMs: 5000,
  }))
}

export { tomlToCordisPatch }
