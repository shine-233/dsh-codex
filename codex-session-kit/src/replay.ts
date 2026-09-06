// Rollout replay, distilled from openai/codex rollout crate (Apache-2.0,
// anchor rust-v0.153.4): reconstruct an ordered event stream from parsed
// rollout items and derive resume/fork points. Upstream's full crate adds
// compression, ordinal bookkeeping and persistence metrics; this distillation
// keeps the replay semantics dsh needs: ordered normalized events, seq-based
// resume/fork slicing, and turn boundaries.
import { parseRolloutText, toDshEvents } from './index.js'

export interface ReplayEvent { type: string; payload: any; seq: number }
export interface ReplayResult {
  events: ReplayEvent[]
  /** Number of replayed items — the resume point for a fork at the end. */
  lastSeq: number
  /** User/assistant message events in order. */
  messages: { role: 'user' | 'assistant'; text: string; seq: number }[]
}

/**
 * Replay parsed rollout items into normalized events with sequence numbers.
 * `atSeq` replays only a prefix (fork/resume semantics): items are 1-indexed
 * in file order; atSeq = N replays the first N items.
 */
export function replayRollout(items: any[], opts: { atSeq?: number } = {}): ReplayResult {
  const limit = typeof opts.atSeq === 'number' ? Math.max(0, Math.min(opts.atSeq, items.length)) : items.length
  const events: ReplayEvent[] = []
  const messages: ReplayResult['messages'] = []
  let lastSeq = 0
  for (let i = 0; i < limit; i++) {
    const item = items[i]
    const seq = i + 1
    lastSeq = seq
    events.push({ type: String(item?.type ?? 'unknown'), payload: item, seq })
    // User/assistant message extraction mirrors toDshEvents' response_item face.
    const payload = item?.payload
    if (item?.type === 'response_item' && payload?.type === 'message') {
      const role = payload.role === 'assistant' ? 'assistant' : 'user'
      const text = Array.isArray(payload.content)
        ? payload.content.filter((c: any) => c?.type === 'output_text' || c?.type === 'input_text')
            .map((c: any) => c.text ?? '').join('\n').trim()
        : ''
      if (text) messages.push({ role, text, seq })
    }
  }
  return { events, lastSeq, messages }
}

/**
 * Replay a rollout FILE (raw JSONL text) — combines parseRolloutText with
 * replayRollout, surfacing bad-line counts alongside the replay.
 */
export function replayRolloutText(text: string, opts: { atSeq?: number } = {}): ReplayResult & { badLines: number } {
  const parsed = parseRolloutText(text)
  const replayed = replayRollout(parsed.items, opts)
  return { ...replayed, badLines: parsed.badLines }
}

/** The fork point for continuing at `atSeq`: everything before it, verbatim. */
export function forkPrefix(items: any[], atSeq: number): any[] {
  return items.slice(0, Math.max(0, Math.min(atSeq, items.length)))
}
