// dsh plugin entry for codex-schema (wire-protocol contracts from openai/codex).
// The generated protocol surface is TypeScript types; the runtime value here is
// provenance metadata + a hand-written protocol validator registry.
import * as handwritten from './handwritten/protocol/types.js';

export const name = 'codex-schema'
export const inject = ['tools']

export function schemaInfo() {
  return {
    anchor: 'openai/codex@970b7f2ff4f6',
    license: 'Apache-2.0',
    surfaces: ['app-server-protocol/v2', 'protocol', 'exec-server-protocol', 'code-mode-protocol', 'history'],
    note: 'types-only package; import types from @shine233/codex-schema in TS code',
  }
}

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const defineTool = (d) => d
  ctx.tools.register(defineTool({
    name: 'codex_schema_info',
    description: 'Provenance and coverage info for the ported openai/codex wire-protocol type contracts.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute() { return JSON.stringify(schemaInfo(), null, 2) },
    timeoutMs: 3000,
  }))
}

export { handwritten }
