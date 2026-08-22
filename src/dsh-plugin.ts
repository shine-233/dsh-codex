// dsh plugin entry for codex-prompts (battle-tested prompt assets from openai/codex)
import { listTemplates, loadTemplate, buildSystemPrompt } from './index.js';

export const name = 'codex-prompts'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const defineTool = (d) => d
  ctx.tools.register(defineTool({
    name: 'codex_prompts',
    description: 'Vendored openai/codex prompt templates. Actions: list all templates, get one raw template, or build a system prompt from several with {{var}} substitution.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'build'] },
      path: { type: 'string', description: 'template path for action=get' },
      paths: { type: 'array', description: 'template paths for action=build' },
      vars: { type: 'object', description: '{{key}} substitutions for action=build' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const action = String(args?.action ?? 'list')
      if (action === 'list') return JSON.stringify(listTemplates(), null, 2)
      if (action === 'get') return loadTemplate(String(args?.path ?? ''))
      const paths = Array.isArray(args?.paths) ? args.paths.map(String) : []
      if (!paths.length) return JSON.stringify({ error: 'paths required for build' })
      return buildSystemPrompt(paths, args?.vars && typeof args.vars === 'object' ? args.vars : {})
    },
    timeoutMs: 5000,
  }))
}

export { listTemplates, loadTemplate, buildSystemPrompt }
