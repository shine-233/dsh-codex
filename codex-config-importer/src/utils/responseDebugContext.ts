// Distilled from openai/codex response-debug-context (Apache-2.0,
// rust-v0.153.4): a bounded debug envelope attached to model responses so a
// failed/odd turn can be inspected without dumping the whole history.
export interface ResponseDebugContext {
  turnId?: string
  model?: string
  attempt?: number
  requestByteSize?: number
  responseByteSize?: number
  durationMs?: number
  error?: string
}

const MAX_SNIPPET = 2000

/** Build the debug envelope; long error text is snippeted to stay bounded. */
export function buildResponseDebugContext(input: ResponseDebugContext): ResponseDebugContext {
  const out: ResponseDebugContext = { ...input }
  if (out.error && out.error.length > MAX_SNIPPET) {
    out.error = out.error.slice(0, MAX_SNIPPET) + `…(+${out.error.length - MAX_SNIPPET} bytes)`
  }
  return out
}
