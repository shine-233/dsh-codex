// Distilled from openai/codex ext/extension-api (Apache-2.0, rust-v0.153.4):
// the third-party extension tool face — a tool spec with JSON-schema input and
// an executor binding. P2-2: field validation formalized as a zod schema
// (single source for the future z.infer types); the ok/variant/error contract
// is unchanged (semantic-locked by test/validatorSemantics.test.ts).
import { z } from 'zod'
import { isPlainObject, firstIssue } from '../zodUnion.js'

export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

export interface ExtensionToolSpec {
  name: string
  description: string
  /** JSON-schema-shaped input contract */
  inputSchema: unknown
  deferLoading: boolean
}

/** Original laxity: `typeof === 'object' && !== null` — arrays pass, null/missing fail. */
const objectLax = z.custom<unknown>((v) => typeof v === 'object' && v !== null, {
  message: 'inputSchema must be an object',
})

const ExtensionToolSpecSchema = z.object({
  name: z.string({ invalid_type_error: 'name must match [A-Za-z0-9_.-]' }).regex(/^[A-Za-z0-9_.-]+$/, 'name must match [A-Za-z0-9_.-]'),
  description: z.string({ invalid_type_error: 'description must be a string', required_error: 'description must be a string' }),
  inputSchema: objectLax,
  deferLoading: z.boolean({ invalid_type_error: 'deferLoading must be boolean', required_error: 'deferLoading must be boolean' }),
}).passthrough()

/**
 * Validate an extension tool spec: requires a dotted/dashed-safe tool name, a
 * string description, and an object-shaped JSON schema.
 */
export function validateExtensionToolSpec(j: unknown): ValidationResult {
  if (!isPlainObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const r = ExtensionToolSpecSchema.safeParse(j)
  return r.success
    ? { ok: true, variant: 'tool_spec' }
    : { ok: false, variant: 'tool_spec', error: firstIssue(r.error) }
}
