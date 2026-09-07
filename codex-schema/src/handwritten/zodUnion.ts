// Shared zod-backed union dispatch for the handwritten sketch validators
// (P2-2 formalization). The sketch semantics — tag dispatch, variant tagging,
// extra-key tolerance — live HERE so every module stays 1:1 with the original
// guards; per-variant member payloads are zod schemas (the future type source).
import { z } from 'zod'

export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

/** Original guard object test: objects but NOT arrays. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function firstIssue(e: z.ZodError): string {
  const i = e.issues[0]
  return i ? `${i.path.join('.') || '(root)'}: ${i.message}` : 'invalid payload'
}

/**
 * Member-field sugar: required string fields (isStr semantics — null fails),
 * optional string fields (isOptStr — undefined/null/string), and keys that
 * must merely be DEFINED (any value, but `key in value` / `!== undefined`).
 */
export interface SketchFields {
  strings?: Record<string, string>
  optionalStrings?: string[]
  definedKeys?: string[]
}

export function sketchMember(spec: SketchFields = {}): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [k, msg] of Object.entries(spec.strings ?? {})) {
    shape[k] = z.string({ invalid_type_error: msg, required_error: msg })
  }
  for (const k of spec.optionalStrings ?? []) {
    shape[k] = z.string().nullish()
  }
  let base: z.ZodTypeAny = z.object(shape).passthrough()
  const defined = spec.definedKeys ?? []
  if (defined.length) {
    base = base.superRefine((v, ctx) => {
      for (const k of defined) {
        if ((v as Record<string, unknown>)[k] === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `requires \`${k}\`` })
        }
      }
    })
  }
  return base
}

/**
 * Presence by key-existence (original requireFields: `k in v`, any value —
 * including explicitly-`undefined` values, which zod's parse would strip).
 * Runs on the RAW input via z.custom so no key is ever dropped pre-check.
 */
export function presenceKeys(...keys: string[]): z.ZodTypeAny {
  return z.custom<Record<string, unknown>>((v) => {
    if (!isPlainObject(v)) return false
    return keys.every((k) => k in v)
  }, { message: 'missing required key(s)' })
}

/**
 * Tagged-union dispatch identical to the original hand guards:
 *  - non-object (incl. arrays) → variant null, 'not an object'
 *  - non-string tag            → variant null, 'missing string `<tag>`'
 *  - unknown tag               → variant = tag, 'unknown variant: <tag>'
 *  - member schema fail        → variant = tag, first zod issue
 *  - success                   → variant = tag
 */
export function zodUnion(
  j: unknown,
  tagKey: string,
  members: Record<string, z.ZodTypeAny>,
): ValidationResult {
  if (!isPlainObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j[tagKey]
  if (typeof tag !== 'string') return { ok: false, variant: null, error: `missing string \`${tagKey}\`` }
  const schema = members[tag]
  if (!schema) return { ok: false, variant: tag, error: `unknown variant: ${tag}` }
  const r = schema.safeParse(j)
  return r.success ? { ok: true, variant: tag } : { ok: false, variant: tag, error: firstIssue(r.error) }
}

/** None-tagged enum sketch (RequestId / EnvironmentConfigState shape). */
export function zodNoneTagged(
  j: unknown,
  variants: readonly string[],
  errorPrefix: string,
): ValidationResult {
  if (!isPlainObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j.None
  if (typeof tag === 'string' && variants.includes(tag)) return { ok: true, variant: tag }
  return { ok: false, variant: null, error: `${errorPrefix}: ${String(tag)}` }
}
