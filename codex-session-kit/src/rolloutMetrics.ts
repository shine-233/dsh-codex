// Rollout persistence + compression metrics, distilled from openai/codex rollout
// (Apache-2.0, anchor rust-v0.153.4). Upstream tracks ordinal / compression /
// persistence metadata alongside rollouts; this distillation scans a sessions
// directory and reports how many rollouts are persisted, how many are
// compressed, and how many bytes compression saved. Pure, deterministic, zero
// native deps — pairs with sessionCompression.ts (which performs the gzip).
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readSessionFile } from './sessionCompression.js'

export interface RolloutMetrics {
  /** Total rollout files (compressed + uncompressed). */
  total: number
  /** Uncompressed *.jsonl rollout files. */
  uncompressed: number
  /** Compressed *.jsonl.gz rollout files. */
  compressed: number
  /** Combined size on disk (raw + compressed bytes). */
  totalBytes: number
  /** Sum of uncompressed payload sizes (the basis compression saved against). */
  uncompressedBytes: number
  /** Sum of compressed payload sizes currently on disk. */
  compressedBytes: number
  /** uncompressedBytes - compressedBytes (>= 0). */
  savedBytes: number
  /** savedBytes / uncompressedBytes * 100, or 0 when nothing to compress. */
  savedPct: number
  /** Ordinal = number of persisted rollout generations (monotonic sequence). */
  ordinal: number
  /** True when at least one rollout is persisted to disk. */
  persisted: boolean
}

const JSONL = '.jsonl'
const GZ = '.jsonl.gz'

/** Scan a sessions directory and report persistence / compression metrics. */
export function rolloutPersistenceMetrics(sessionsDir: string): RolloutMetrics {
  const m: RolloutMetrics = {
    total: 0, uncompressed: 0, compressed: 0,
    totalBytes: 0, uncompressedBytes: 0, compressedBytes: 0,
    savedBytes: 0, savedPct: 0, ordinal: 0, persisted: false,
  }
  if (!existsSync(sessionsDir)) return m
  for (const f of readdirSync(sessionsDir)) {
    const full = join(sessionsDir, f)
    if (!statSync(full).isFile()) continue
    const bytes = statSync(full).size
    if (f.endsWith(GZ)) {
      m.compressed++; m.total++; m.totalBytes += bytes; m.compressedBytes += bytes
      // Reconstruct raw payload to measure real savings.
      try {
        const raw = readSessionFile(full)
        m.uncompressedBytes += Buffer.byteLength(raw, 'utf8')
      } catch {
        // Unreadable gz: count stored bytes as its own baseline.
        m.uncompressedBytes += bytes
      }
    } else if (f.endsWith(JSONL)) {
      m.uncompressed++; m.total++; m.totalBytes += bytes; m.uncompressedBytes += bytes
    }
  }
  m.ordinal = m.total
  m.persisted = m.total > 0
  m.savedBytes = Math.max(0, m.uncompressedBytes - m.compressedBytes)
  m.savedPct = m.uncompressedBytes > 0 ? (m.savedBytes / m.uncompressedBytes) * 100 : 0
  return m
}
