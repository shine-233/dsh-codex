// Runtime validators for the history RolloutItem union — the first M1 sketch
// upgraded from a mechanical translation to executable validation (zero deps,
// hand-rolled guards so the types-only package stays dependency-free).
// Source shape: openai/codex history crate at rust-v0.153.4.
export type RolloutItemType =
  | 'session_meta'
  | 'response_item'
  | 'inter_agent_communication'
  | 'compacted'
  | 'turn_context'
  | 'world_state'
  | 'security_risk_score'
  | 'event_msg'
  | 'token_usage_record'
  | 'realtime_item'

const KNOWN_TYPES: readonly RolloutItemType[] = [
  'session_meta', 'response_item', 'inter_agent_communication', 'compacted',
  'turn_context', 'world_state', 'security_risk_score', 'event_msg',
  'token_usage_record', 'realtime_item',
]

export interface ValidatedRolloutItem {
  ok: boolean
  type: RolloutItemType | null
  /** snake_case error path description when ok === false */
  error?: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate one parsed rollout JSONL line as a RolloutItem. Tolerant on payload
 * shape (payloads vary across upstream versions) but strict on the envelope:
 * an object with a known string `type` and (except session_meta) a `payload`
 * member.
 */
export function validateRolloutItem(j: unknown): ValidatedRolloutItem {
  if (!isObject(j)) return { ok: false, type: null, error: 'line is not an object' }
  const type = j.type
  if (typeof type !== 'string') return { ok: false, type: null, error: 'missing string `type`' }
  if (!KNOWN_TYPES.includes(type as RolloutItemType)) {
    return { ok: false, type: null, error: `unknown RolloutItem type: ${type}` }
  }
  if (type !== 'session_meta' && !('payload' in j)) {
    return { ok: false, type: type as RolloutItemType, error: `${type} missing payload` }
  }
  if (type === 'token_usage_record' && !isObject(j.payload)) {
    return { ok: false, type: 'token_usage_record', error: 'token_usage_record payload must be an object' }
  }
  if (type === 'realtime_item' && !isObject(j.payload)) {
    return { ok: false, type: 'realtime_item', error: 'realtime_item payload must be an object' }
  }
  return { ok: true, type: type as RolloutItemType }
}
