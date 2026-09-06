// Token/turn estimation, distilled from openai/codex core/src/context_manager
// history.rs (Apache-2.0, anchor rust-v0.153.4). Feeds dsh compaction with the
// same cost model codex uses: 4 bytes/token, a fixed resized-image byte
// estimate, and user-turn boundary detection.
import { APPROX_BYTES_PER_TOKEN } from './approx.js'

/**
 * Model-visible byte cost for one image input. Upstream converts bytes to
 * tokens with the 4-bytes/token heuristic, so 7,373 bytes ≈ 1,844 tokens.
 * The `detail: "original"` 32px-patch-count path needs image dimensions; this
 * distillation returns the resized estimate for every detail level.
 */
export const RESIZED_IMAGE_BYTES_ESTIMATE = 7373

export function approxTokensFromByteCount(bytes: number): number {
  if (bytes <= 0) return 0
  return Math.floor((bytes + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN)
}

/** Base64 data-URL payload byte count, or 0 when not a data URL. */
function dataUrlPayloadBytes(url: string): number {
  const m = /^data:[^;,]*;base64,(.*)$/.exec(url)
  return m ? m[1].length : 0
}

export function estimateImageBytes(imageUrl: string, detail?: string | null): number {
  void detail // upstream's original-detail patch-count path needs image dimensions
  return RESIZED_IMAGE_BYTES_ESTIMATE
}

/**
 * Model-visible byte estimate for one normalized dsh event payload:
 * raw JSON bytes, minus inline base64 image payloads, plus their resized
 * estimates (upstream image_data_url_estimate_adjustment).
 */
export function estimateEventModelVisibleBytes(payload: unknown): number {
  const raw = Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8')
  let payloadBytes = 0
  let replacementBytes = 0
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if ((k === 'image_url' || k === 'imageUrl' || k === 'audio_url' || k === 'audioUrl') && typeof val === 'string') {
          const b = dataUrlPayloadBytes(val)
          if (b > 0) { payloadBytes += b; replacementBytes += RESIZED_IMAGE_BYTES_ESTIMATE }
        }
        walk(val)
      }
    }
  }
  walk(payload)
  return Math.max(1, raw - payloadBytes + replacementBytes)
}

export function estimateItemTokenCount(payload: unknown): number {
  return approxTokensFromByteCount(estimateEventModelVisibleBytes(payload))
}

/**
 * User-turn boundary: upstream marks AgentMessage and non-contextual user
 * messages as turn starts. In the normalized dsh face: a user message event.
 */
export function isUserTurnBoundary(event: { type: string; payload?: any }): boolean {
  if (event.type === 'agent_message' || event.type === 'user_message') return true
  // response_item events: payload IS the ResponseItem ({type:'message', role, ...})
  const item = event.payload
  return event.type === 'response_item' && item?.type === 'message' && item?.role === 'user'
}
