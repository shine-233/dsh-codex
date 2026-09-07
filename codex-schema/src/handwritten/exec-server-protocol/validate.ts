// Runtime validators for the exec-server-protocol sketch (M1 → executable).
// Guards mirror the sketch interfaces (upstream rust-v0.153.4).
// P2-2: payloads formalized as zod schemas; contract semantic-locked by tests.
import { z } from 'zod'
import { zodUnion, sketchMember, zodNoneTagged, isPlainObject } from '../zodUnion.js'

export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

// ── ExecServerNetworkPolicyDecision (type-tagged; both variants carry reason) ──

export function validateNetworkPolicyDecision(j: unknown): ValidationResult {
  return zodUnion(j, 'type', {
    Deny: sketchMember({ strings: { reason: 'Deny requires string `reason`' } }),
    Ask: sketchMember({ strings: { reason: 'Ask requires string `reason`' } }),
  })
}

// ── RequestId (None-tagged sketch: String | Integer) ─────────────────────────

export function validateRequestId(j: unknown): ValidationResult {
  return zodNoneTagged(j, ['String', 'Integer'], 'unknown RequestId variant')
}

// ── JSONRPCMessage (None-tagged sketch: Request/Notification/Response/Error) ──

const JSONRPCMessageMembers: Record<string, z.ZodTypeAny> = {
  Request: sketchMember(),
  Notification: sketchMember(),
  Response: sketchMember().superRefine((v, ctx) => {
    const r = v as Record<string, unknown>
    if (r.result === undefined && r.error === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Response requires `result` or `error`' })
    }
  }),
  Error: z.object({
    error: z.object({
      code: z.number({ invalid_type_error: 'Error requires `error.code:number` and `error.message:string`' }),
      message: z.string({ invalid_type_error: 'Error requires `error.code:number` and `error.message:string`' }),
    }).passthrough(),
  }).passthrough(),
}

export function validateJSONRPCMessage(j: unknown): ValidationResult {
  const out = zodUnion(j, 'None', JSONRPCMessageMembers)
  // Original nuance: a missing tag on JSONRPCMessage reports the generic
  // unknown-variant path (not 'missing string `None`').
  if (!out.ok && out.error === 'missing string `None`' && isPlainObject(j)) {
    return { ok: false, variant: null, error: `unknown JSONRPCMessage variant: ${String(j.None)}` }
  }
  return out
}
