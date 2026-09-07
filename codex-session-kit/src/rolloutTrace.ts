// Distilled from openai/codex rollout-trace (Apache-2.0, rust-v0.153.4):
// a trace timeline over rollout items — tool calls grouped per turn with
// status, compaction markers, and token-usage checkpoints.
export interface TraceEntry {
  seq: number
  kind: 'message' | 'tool_call' | 'compaction' | 'usage' | 'other'
  role?: string
  name?: string
  status?: string
  text?: string
}

/** Build a trace timeline from parsed rollout items (see replay.ts). */
export function traceTimeline(items: any[]): TraceEntry[] {
  const trace: TraceEntry[] = []
  for (const [i, item] of items.entries()) {
    const seq = i + 1
    const type = item?.type
    if (type === 'session_meta') continue
    if (type === 'response_item') {
      const p = item.payload ?? {}
      if (p.type === 'message') {
        const role = p.role ?? 'unknown'
        const text = Array.isArray(p.content)
          ? p.content.filter((c: any) => c?.type === 'output_text' || c?.type === 'input_text')
              .map((c: any) => c.text ?? '').join('\n').trim()
          : ''
        trace.push({ seq, kind: 'message', role, text: text.slice(0, 200) })
        continue
      }
      if (p.type === 'function_call' || p.type === 'local_shell_call') {
        trace.push({ seq, kind: 'tool_call', name: p.name ?? p.action?.type ?? 'unknown', status: 'completed' })
        continue
      }
      if (p.type === 'function_call_output') {
        trace.push({ seq, kind: 'other', name: 'function_call_output' })
        continue
      }
    }
    if (type === 'compacted') { trace.push({ seq, kind: 'compaction' }); continue }
    if (type === 'token_usage_record') { trace.push({ seq, kind: 'usage' }); continue }
    trace.push({ seq, kind: 'other', name: type ?? 'unknown' })
  }
  return trace
}

/** Per-turn rollup: messages, tool calls and usage between turn boundaries. */
export function turnSummaries(trace: TraceEntry[]): { turn: number; messages: number; toolCalls: number; usage: number }[] {
  const turns: { turn: number; messages: number; toolCalls: number; usage: number }[] = [{ turn: 1, messages: 0, toolCalls: 0, usage: 0 }]
  for (const e of trace) {
    const cur = turns[turns.length - 1]
    if (e.kind === 'message' && e.role === 'user' && (cur.messages || cur.toolCalls)) turns.push({ turn: turns.length + 1, messages: 0, toolCalls: 0, usage: 0 })
    const t = turns[turns.length - 1]
    if (e.kind === 'message') t.messages++
    if (e.kind === 'tool_call') t.toolCalls++
    if (e.kind === 'usage') t.usage++
  }
  return turns
}
