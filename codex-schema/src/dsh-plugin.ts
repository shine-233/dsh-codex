// dsh plugin entry for codex-schema (wire-protocol contracts from openai/codex).
// The generated protocol surface is TypeScript types; the runtime value here is
// provenance metadata + a hand-written protocol validator registry.
import * as handwritten from './handwritten/protocol/types.js';

export const name = 'codex-schema'
export const inject = ['tools']

export function schemaInfo() {
  return {
    anchor: 'openai/codex@rust-v0.153.4 (d347e70 lineage: 042fb41b7c813ac7999105e886b2b7aa715b5081)',
    license: 'Apache-2.0',
    surfaces: ['app-server-protocol/v2', 'protocol', 'exec-server-protocol', 'code-mode-protocol', 'history'],
    note: 'types-only package; import types from @shine233/codex-schema in TS code',
  }
}

export function apply(ctx: unknown, config: Record<string, unknown> = {}): void {
  const c = ctx as { tools?: { register?: (d: unknown) => void } } | null
  if (!c?.tools?.register) return
  const defineTool = (d: unknown) => d
  c.tools.register(defineTool({
    name: 'codex_schema_info',
    description: 'Provenance and coverage info for the ported openai/codex wire-protocol type contracts.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] },
    async execute() { return JSON.stringify(schemaInfo(), null, 2) },
    timeoutMs: 3000,
  }))
}

export { handwritten }
