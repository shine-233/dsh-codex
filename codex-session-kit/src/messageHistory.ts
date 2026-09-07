// Distilled from openai/codex message-history (Apache-2.0, rust-v0.153.4):
// an append-only cross-session message history (history.jsonl) with
// byte-capped size and offset-based lookup.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface HistoryEntry { sessionId: string; ts: number; text: string }

export interface HistoryConfig { codexHome: string; maxBytes?: number }

const HISTORY_FILENAME = 'history.jsonl'

export class MessageHistory {
  private path: string
  private maxBytes: number

  constructor(config: HistoryConfig) {
    this.path = join(config.codexHome, HISTORY_FILENAME)
    this.maxBytes = config.maxBytes ?? 16 * 1024 * 1024
    if (!existsSync(this.path)) {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, '')
    }
  }

  /** Append one entry, keeping the log under the byte cap. */
  add(entry: Omit<HistoryEntry, 'ts'>): void {
    const full: HistoryEntry = { ...entry, ts: Date.now() }
    let lines = existsSync(this.path) ? readFileSync(this.path, 'utf8').split('\n').filter(Boolean) : []
    lines.push(JSON.stringify(full))
    while (lines.length && Buffer.byteLength(lines.join('\n'), 'utf8') > this.maxBytes) lines.shift()
    writeFileSync(this.path, lines.map((l) => l).join('\n') + '\n')
  }

  /** Lookup by log id (1-based) and an in-entry message offset (batch face). */
  lookup(logId: number, offset = 0): HistoryEntry | null {
    if (!existsSync(this.path)) return null
    const lines = readFileSync(this.path, 'utf8').split('\n').filter(Boolean)
    const line = lines[logId - 1]
    if (line === undefined) return null
    const entry = JSON.parse(line) as HistoryEntry
    return { ...entry, text: entry.text.slice(offset) }
  }

  /** All entries for one session, newest last. */
  bySession(sessionId: string): HistoryEntry[] {
    if (!existsSync(this.path)) return []
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as HistoryEntry)
      .filter((e) => e.sessionId === sessionId)
  }
}
