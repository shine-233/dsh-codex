// Runtime validators for the code-mode-protocol sketch (M1 → executable).
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

const isStr = (v: unknown): boolean => typeof v === 'string'
const isArr = (v: unknown): boolean => Array.isArray(v)

function requireFields(v: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) if (!(f in v)) return `missing \`${f}\``
  return null
}

// ── WireContentItem (type-tagged) ───────────────────────────────────────────

export function validateWireContentItem(j: unknown): ValidationResult {
  return union(j, 'type', {
    InputText: (v) => (isStr(v.text) ? null : 'InputText requires string `text`'),
    InputImage: (v) => (isStr(v.imageUrl) ? null : 'InputImage requires string `imageUrl`'),
    InputAudio: (v) => (isStr(v.audioUrl) ? null : 'InputAudio requires string `audioUrl`'),
  })
}

// ── WireRuntimeResponse (None-tagged; Yielded/Terminated share shape, Result adds error_text) ──

const WIRE_RUNTIME_RESPONSE_MEMBERS: Record<string, (v: Record<string, unknown>) => string | null> = {
  Yielded: (v) => requireFields(v, ['cell_id', 'content_items']),
  Terminated: (v) => requireFields(v, ['cell_id', 'content_items']),
  Result: (v) => requireFields(v, ['cell_id', 'content_items', 'error_text']),
}

export function validateWireRuntimeResponse(j: unknown): ValidationResult {
  return union(j, 'None', WIRE_RUNTIME_RESPONSE_MEMBERS)
}

// ── RuntimeResponse (CellId + FunctionCallOutputContentItem face) ───────────

const RUNTIME_RESPONSE_MEMBERS: Record<string, (v: Record<string, unknown>) => string | null> = {
  Yielded: (v) => requireFields(v, ['cell_id', 'content_items']),
  Terminated: (v) => requireFields(v, ['cell_id', 'content_items']),
  Result: (v) => requireFields(v, ['cell_id', 'content_items', 'error_text']),
}

export function validateRuntimeResponse(j: unknown): ValidationResult {
  return union(j, 'None', RUNTIME_RESPONSE_MEMBERS)
}

// ── WaitOutcome / WaitToPendingOutcome (None-tagged: LiveCell | MissingCell) ──

const WAIT_MEMBERS = {
  LiveCell: () => null,
  MissingCell: () => null,
}

export function validateWaitOutcome(j: unknown): ValidationResult {
  return union(j, 'None', WAIT_MEMBERS)
}

export function validateWaitToPendingOutcome(j: unknown): ValidationResult {
  return union(j, 'None', WAIT_MEMBERS)
}

// ── ExecuteToPendingOutcome (None-tagged; Pending carries cell/work items) ──

export function validateExecuteToPendingOutcome(j: unknown): ValidationResult {
  return union(j, 'None', {
    Pending: (v) => requireFields(v, ['cell_id', 'content_items', 'pending_tool_call_ids']),
    Completed: () => null,
  })
}

// ── FunctionCallOutputContentItem (code-mode face; type-tagged) ─────────────

export function validateFunctionCallOutputContentItem(j: unknown): ValidationResult {
  return union(j, 'type', {
    InputText: (v) => (isStr(v.text) ? null : 'InputText requires string `text`'),
    InputImage: (v) => (isStr(v.imageUrl) ? null : 'InputImage requires string `imageUrl`'),
    InputAudio: (v) => (isStr(v.audioUrl) ? null : 'InputAudio requires string `audioUrl`'),
  })
}
