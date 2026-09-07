// Distilled from openai/codex ext/extension-api (Apache-2.0, rust-v0.153.4):
// the third-party extension tool face — a tool spec with JSON-schema input and
// an executor binding. Zero-dependency runtime guards (M1 → executable).
export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export interface ExtensionToolSpec {
  name: string
  description: string
  /** JSON-schema-shaped input contract */
  inputSchema: unknown
  deferLoading: boolean
}

/**
 * Validate an extension tool spec: requires a dotted/dashed-safe tool name, a
 * string description, and an object-shaped JSON schema.
 */
export function validateExtensionToolSpec(j: unknown): ValidationResult {
  if (!isObject(j)) return { ok: false, variant: null, error: 'not an object' }
  if (typeof j.name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(j.name)) {
    return { ok: false, variant: 'tool_spec', error: 'name must match [A-Za-z0-9_.-]' }
  }
  if (typeof j.description !== 'string') return { ok: false, variant: 'tool_spec', error: 'description must be a string' }
  if (typeof j.inputSchema !== 'object' || j.inputSchema === null) {
    return { ok: false, variant: 'tool_spec', error: 'inputSchema must be an object' }
  }
  if (typeof j.deferLoading !== 'boolean') return { ok: false, variant: 'tool_spec', error: 'deferLoading must be boolean' }
  return { ok: true, variant: 'tool_spec' }
}
