// Structured memory store, distilled from openai/codex memories/write +
// memories/read (Apache-2.0, anchor rust-v0.153.4). Upstream runs an LLM
// consolidation pipeline over markdown memory artifacts (raw_memories.md with
// per-origin sections, rollout_summaries/, extensions/) with growth guards and
// pruning. This distillation keeps the FILE FORMAT and the write/read/prune
// semantics; the LLM consolidation pipeline itself is out of scope (dsh runs
// its own compaction).
//
// Layout (mirrors upstream artifacts/):
//   <memoryDir>/raw_memories.md            — one `## <origin>` section per origin
//   <memoryDir>/rollout_summaries/<stem>.md — per-origin summary notes
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW_MEMORIES_FILENAME = 'raw_memories.md'
const ROLLOUT_SUMMARIES_SUBDIR = 'rollout_summaries'

/** Origin stems must be filesystem-safe (upstream rollout_summary_file_stem). */
export function rolloutSummaryFileStem(origin: string): string {
  return origin.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed'
}

export class StructuredMemoryStore {
  readonly memoryDir: string
  private rawPath: string

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir
    this.rawPath = join(memoryDir, RAW_MEMORIES_FILENAME)
    mkdirSync(join(memoryDir, ROLLOUT_SUMMARIES_SUBDIR), { recursive: true })
  }

  private readRaw(): string {
    return existsSync(this.rawPath) ? readFileSync(this.rawPath, 'utf8') : ''
  }

  private writeRaw(content: string): void {
    writeFileSync(this.rawPath, content)
  }

  /** Write/replace the memory section for one origin (bounded, idempotent). */
  writeMemory(origin: string, text: string, opts: { maxChars?: number } = {}): void {
    const max = opts.maxChars ?? 16384
    const body = text.slice(0, max)
    const stem = rolloutSummaryFileStem(origin)
    // per-origin summary artifact
    writeFileSync(join(this.memoryDir, ROLLOUT_SUMMARIES_SUBDIR, `${stem}.md`), body)
    // raw_memories.md section rewrite
    const raw = this.readRaw()
    const sectionRe = new RegExp(`^## ${escapeRe(origin)}\\n[\\s\\S]*?(?=\\n## |$)`, 'm')
    const section = `## ${origin}\n${body}\n`
    this.writeRaw(sectionRe.test(raw) ? raw.replace(sectionRe, section) : raw + (raw && !raw.endsWith('\n') ? '\n' : '') + section)
  }

  /** Read one origin's memory section (null when absent). */
  readMemory(origin: string): string | null {
    const m = new RegExp(`^## ${escapeRe(origin)}\\n([\\s\\S]*?)(?=\\n## |$)`, 'm').exec(this.readRaw())
    return m ? m[1].trimEnd() : null
  }

  /** List origins that currently have memory sections. */
  listOrigins(): string[] {
    return [...this.readRaw().matchAll(/^## (.+)$/gm)].map((m) => m[1])
  }

  /**
   * Growth guard: keep only origins whose summaries still exist under
   * rollout_summaries/ (upstream sync_rollout_summaries_from_memories /
   * rebuild_raw_memories_file_from_memories semantics, inverted direction).
   */
  rebuildFromSummaries(): number {
    const dir = join(this.memoryDir, ROLLOUT_SUMMARIES_SUBDIR)
    const stems = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)))
    const origins = this.listOrigins()
    const kept = origins.filter((o) => stems.has(rolloutSummaryFileStem(o)))
    const rebuilt = kept.map((o) => `## ${o}\n${this.readMemory(o) ?? ''}\n`).join('\n')
    this.writeRaw(rebuilt)
    return origins.length - kept.length
  }

  /** Prune one origin entirely (upstream prune_old_extension_resources face). */
  forget(origin: string): void {
    const stem = rolloutSummaryFileStem(origin)
    rmSync(join(this.memoryDir, ROLLOUT_SUMMARIES_SUBDIR, `${stem}.md`), { force: true })
    this.writeRaw(this.readRaw().replace(new RegExp(`^## ${escapeRe(origin)}\\n[\\s\\S]*?(?=\\n## |$)`, 'm'), ''))
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
