// dsh plugin entry for codex-config-importer (codex config.toml -> cordis.patch.yml)
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseTomlLite, tomlToCordisPatch } from './tomlImporter.js';

export const name = 'codex-config-importer'
export const inject = ['tools']

type UnknownRecord = Record<string, unknown>
type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: string; text: string }[]
  }
  execute: (args: unknown) => Promise<string>
  timeoutMs: number
}
type ToolHost = { tools: { register: (tool: ToolDefinition) => unknown } }

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function isToolHost(value: unknown): value is ToolHost {
  const tools = asRecord(asRecord(value).tools)
  return typeof tools.register === 'function'
}

export function apply(ctx: unknown, config: unknown = {}): void {
  if (!isToolHost(ctx)) return
  const cfg = asRecord(config)
  const defineTool = <T extends ToolDefinition>(d: T): T => d
  ctx.tools.register(defineTool({
    name: 'codex_config_import',
    description: 'Read an openai/codex config.toml and emit an equivalent dsh cordis.patch.yml overlay (llm route + provider wiring). Read-only: returns YAML text.',
    parameters: {
      configPath: { type: 'string', description: 'path to codex config.toml; defaults to ~/.codex/config.toml' },
    },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: value as string }] },
    async execute(rawArgs: unknown): Promise<string> {
      const args = asRecord(rawArgs)
      const fallback = join(homedir(), '.codex', 'config.toml')
      const p = typeof args.configPath === 'string' && args.configPath ? args.configPath : fallback
      const yml = tomlToCordisPatch(p)
      if (!yml) return JSON.stringify({ error: `config not found or nothing to migrate: ${p}` })
      return yml
    },
    timeoutMs: 5000,
  }))
}

export { parseTomlLite, tomlToCordisPatch }
