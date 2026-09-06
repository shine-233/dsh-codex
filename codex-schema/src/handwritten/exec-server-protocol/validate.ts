// Runtime validators for the exec-server-protocol sketch (M1 → executable).
// Zero deps; guards mirror the sketch interfaces (upstream rust-v0.153.4).
export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function union(
  j: unknown,
  tagKey: string,
  members: Record<string, (v: Record<string, unknown>) => string | null>,
): ValidationResult {
  if (!isObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j[tagKey]
  if (typeof tag !== 'string') return { ok: false, variant: null, error: `missing string \`${tagKey}\`` }
  const check = members[tag]
  if (!check) return { ok: false, variant: tag, error: `unknown variant: ${tag}` }
  const err = check(j)
  return err ? { ok: false, variant: tag, error: err } : { ok: true, variant: tag }
}

// ── ExecServerNetworkPolicyDecision (type-tagged; both variants carry reason) ──

export function validateNetworkPolicyDecision(j: unknown): ValidationResult {
  return union(j, 'type', {
    Deny: (v) => (isStr(v.reason) ? null : 'Deny requires string `reason`'),
    Ask: (v) => (isStr(v.reason) ? null : 'Ask requires string `reason`'),
  })
}

const isStr = (v: unknown): boolean => typeof v === 'string'

// ── RequestId (None-tagged sketch: String | Integer) ─────────────────────────

export function validateRequestId(j: unknown): ValidationResult {
  if (!isObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j.None
  if (tag === 'String') return { ok: true, variant: 'String' }
  if (tag === 'Integer') return { ok: true, variant: 'Integer' }
  return { ok: false, variant: null, error: `unknown RequestId variant: ${String(tag)}` }
}

// ── JSONRPCMessage (None-tagged sketch: Request/Notification/Response/Error) ──

export function validateJSONRPCMessage(j: unknown): ValidationResult {
  if (!isObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j.None
  if (tag === 'Response' && (typeof j.result === 'undefined' && typeof j.error === 'undefined')) {
    return { ok: false, variant: 'Response', error: 'Response requires `result` or `error`' }
  }
  if (tag === 'Error') {
    const err = j.error
    if (!isObject(err) || typeof (err as Record<string, unknown>).code !== 'number' || typeof (err as Record<string, unknown>).message !== 'string') {
      return { ok: false, variant: 'Error', error: 'Error requires `error.code:number` and `error.message:string`' }
    }
  }
  if (['Request', 'Notification', 'Response', 'Error'].includes(tag as string)) {
    return { ok: true, variant: tag as string }
  }
  return { ok: false, variant: null, error: `unknown JSONRPCMessage variant: ${String(tag)}` }
}
