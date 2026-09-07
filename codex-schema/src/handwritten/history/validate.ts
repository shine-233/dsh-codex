// Runtime validators for the history RolloutItem union — the first M1 sketch
// upgraded from a mechanical translation to executable validation.
// Source shape: openai/codex history crate at rust-v0.153.4.
// P2-2: the envelope + payload-object rules are zod-superRefine-backed; the
// {ok, type, error} contract is unchanged (semantic-locked by tests).
import { z } from 'zod'
import { isPlainObject, type ValidationResult } from '../zodUnion.js'

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

/**
 * Validate one parsed rollout JSONL line as a RolloutItem. Tolerant on payload
 * shape (payloads vary across upstream versions) but strict on the envelope:
 * an object with a known string `type` and (except session_meta) a `payload`
 * member; token_usage_record / realtime_item payloads must be objects.
 */
export function validateRolloutItem(j: unknown): ValidatedRolloutItem {
  if (!isPlainObject(j)) return { ok: false, type: null, error: 'line is not an object' }
  if (typeof j.type !== 'string') return { ok: false, type: null, error: 'missing string `type`' }
  if (!KNOWN_TYPES.includes(j.type as RolloutItemType)) {
    return { ok: false, type: null, error: `unknown RolloutItem type: ${j.type}` }
  }
  const type = j.type as RolloutItemType
  const EnvelopeSchema = z.object({ type: z.literal(type) }).passthrough().superRefine((v, ctx) => {
    if (v.type !== 'session_meta' && !('payload' in (v as Record<string, unknown>))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v.type} missing payload` })
    }
    if ((v.type === 'token_usage_record' || v.type === 'realtime_item') && !isPlainObject((v as Record<string, unknown>).payload)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v.type} payload must be an object` })
    }
  })
  const r = EnvelopeSchema.safeParse(j)
  return r.success
    ? { ok: true, type }
    : { ok: false, type, error: r.error.issues[0]?.message ?? 'invalid rollout item' }
}
