// dsh plugin entry for codex-prompts (battle-tested prompt assets from openai/codex)
import { listTemplates, loadTemplate, buildSystemPrompt } from './index.js';

export const name = 'codex-prompts'
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

/** Coerce an unknown vars bag into the Record<string,string> shape the renderer expects. */
function toStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(asRecord(value))) out[k] = String(v)
  return out
}

export function apply(ctx: unknown, config: unknown = {}): void {
  if (!isToolHost(ctx)) return
  const defineTool = <T extends ToolDefinition>(d: T): T => d
  ctx.tools.register(defineTool({
    name: 'codex_prompts',
    description: 'Vendored openai/codex prompt templates. Actions: list all templates, get one raw template, or build a system prompt from several with {{var}} substitution.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'build'] },
      path: { type: 'string', description: 'template path for action=get' },
      paths: { type: 'array', description: 'template paths for action=build' },
      vars: { type: 'object', description: '{{key}} substitutions for action=build' },
    },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: value as string }] },
    async execute(rawArgs: unknown): Promise<string> {
      const args = asRecord(rawArgs)
      const action = String(args.action ?? 'list')
      if (action === 'list') return JSON.stringify(listTemplates(), null, 2)
      if (action === 'get') return loadTemplate(String(args.path ?? ''))
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : []
      if (!paths.length) return JSON.stringify({ error: 'paths required for build' })
      return buildSystemPrompt(paths, toStringRecord(args.vars))
    },
    timeoutMs: 5000,
  }))
}

export { listTemplates, loadTemplate, buildSystemPrompt }
