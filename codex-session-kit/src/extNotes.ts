// Distilled from openai/codex ext/history-notes + ext/memories (Apache-2.0,
// rust-v0.153.4): extension-provided notes and memories attached to threads.
// Upstream runs backend.rs/storage-backed extension services; this distillation
// is a local JSONL-backed notes/memory store with the same tool face
// (add/list/remove notes scoped by thread, promoted into memories).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface HistoryNote { threadId: string; key: string; text: string; ts: number }

export class NotesStore {
  private notes: HistoryNote[] = []

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      for (const line of readFileSync(filePath, 'utf8').split('\n').filter(Boolean)) {
        try { this.notes.push(JSON.parse(line)) } catch { /* tolerate */ }
      }
    } else {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, '')
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, this.notes.map((n) => JSON.stringify(n)).join('\n') + (this.notes.length ? '\n' : ''))
  }

  addNote(threadId: string, key: string, text: string): HistoryNote {
    const note: HistoryNote = { threadId, key, text, ts: Date.now() }
    this.notes.push(note)
    this.persist()
    return note
  }

  listNotes(threadId: string, key?: string): HistoryNote[] {
    return this.notes.filter((n) => n.threadId === threadId && (key === undefined || n.key === key))
  }

  removeNotes(threadId: string, key: string): number {
    const before = this.notes.length
    this.notes = this.notes.filter((n) => !(n.threadId === threadId && n.key === key))
    const removed = before - this.notes.length
    this.persist()
    return removed
  }
}
