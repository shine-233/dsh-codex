// Cold-session compression, distilled from openai/codex rollout compression.rs
// (Apache-2.0, anchor rust-v0.153.4). Upstream spawns a fire-and-forget worker
// that zstd-compresses cold rollout files with a run marker preventing
// overlapping runs. This distillation keeps those semantics using node's zlib
// gzip (format difference is deliberate: zero native deps) and is synchronous
// per file (dsh calls it from a scheduled job).
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

const COMPRESSED_SUFFIX = '.gz'
const MARKER_FILENAME = '.compression-run'

export interface CompressionOptions {
  /** Files last modified before this many ms ago are cold. Default 7 days. */
  olderThanMs?: number
  /** Minimum interval between runs (ms). Default 24h. */
  minRunIntervalMs?: number
  /** Delete the original after successful compression (default true). */
  deleteOriginal?: boolean
}

export interface CompressionResult { compressed: string[]; skipped: string[] }

/** Transparent read: gunzips `<file>.gz` automatically. */
export function readSessionFile(path: string): string {
  if (path.endsWith(COMPRESSED_SUFFIX)) return gunzipSync(readFileSync(path)).toString('utf8')
  return readFileSync(path, 'utf8')
}

/** Compress cold *.jsonl session logs. Returns the compressed file paths. */
export function compressColdSessions(sessionsDir: string, opts: CompressionOptions = {}): CompressionResult {
  const olderThanMs = opts.olderThanMs ?? 7 * 24 * 3600 * 1000
  const minRunIntervalMs = opts.minRunIntervalMs ?? 24 * 3600 * 1000
  const deleteOriginal = opts.deleteOriginal ?? true
  const marker = join(sessionsDir, MARKER_FILENAME)
  const result: CompressionResult = { compressed: [], skipped: [] }

  if (!existsSync(sessionsDir)) return result
  if (existsSync(marker) && Date.now() - statSync(marker).mtimeMs < minRunIntervalMs) return result
  writeFileSync(marker, new Date().toISOString())

  const cutoff = Date.now() - olderThanMs
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.jsonl')) continue
    const full = join(sessionsDir, f)
    const st = statSync(full)
    if (st.mtimeMs >= cutoff) { result.skipped.push(f); continue }
    const gz = gzipSync(readFileSync(full), { level: 6 })
    writeFileSync(full + COMPRESSED_SUFFIX, gz)
    if (deleteOriginal) rmSync(full, { force: true })
    result.compressed.push(f + COMPRESSED_SUFFIX)
  }
  return result
}
