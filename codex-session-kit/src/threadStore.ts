// Distilled from openai/codex thread-store (Apache-2.0, rust-v0.153.4):
// storage-neutral thread persistence. Upstream resolves ThreadId to rollout
// files / RPC; this distillation provides the store contract + in-memory and
// JSONL-file implementations with project scoping and queued submissions.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface ThreadMetadata {
  threadId: string
  project: string
  createdAt: number
  title?: string
  source: 'local' | 'imported'
}

export interface QueuedSubmission { threadId: string; text: string; queuedAt: number }

export interface ThreadStore {
  create(meta: Omit<ThreadMetadata, 'createdAt'>): ThreadMetadata
  get(threadId: string): ThreadMetadata | null
  listByProject(project: string): ThreadMetadata[]
  queueSubmission(sub: QueuedSubmission): void
  drainQueue(threadId: string): QueuedSubmission[]
}

export class InMemoryThreadStore implements ThreadStore {
  private threads = new Map<string, ThreadMetadata>()
  private queue: QueuedSubmission[] = []

  create(meta: Omit<ThreadMetadata, 'createdAt'>): ThreadMetadata {
    const full: ThreadMetadata = { ...meta, createdAt: Date.now() }
    this.threads.set(full.threadId, full)
    return full
  }

  get(threadId: string): ThreadMetadata | null { return this.threads.get(threadId) ?? null }

  listByProject(project: string): ThreadMetadata[] {
    return [...this.threads.values()]
      .filter((t) => t.project === project)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  queueSubmission(sub: QueuedSubmission): void {
    this.queue.push(sub)
  }

  drainQueue(threadId: string): QueuedSubmission[] {
    const drained = this.queue.filter((s) => s.threadId === threadId)
    this.queue = this.queue.filter((s) => s.threadId !== threadId)
    return drained
  }
}

function defaultQueueFileFor(threadsFile: string): string {
  return threadsFile.endsWith('.jsonl')
    ? threadsFile.replace(/\.jsonl$/, '.queue.jsonl')
    : threadsFile + '.queue.jsonl'
}

/**
 * Durable JSONL-file backend (P1-4): threads append to `<file>`, the queue to
 * `<file>.queue.jsonl`. State rebuilds on construction, so a new instance (=
 * new process) sees the same threads and queue. Bad lines are tolerated
 * (skipped) like the rollout readers; zero native deps (no sqlite required).
 */
export class JsonlFileThreadStore implements ThreadStore {
  private threads = new Map<string, ThreadMetadata>()
  private queue: QueuedSubmission[] = []

  constructor(
    private threadsFile: string,
    private queueFile: string = defaultQueueFileFor(threadsFile),
  ) {
    this.rebuild()
  }

  private rebuild() {
    this.threads.clear()
    this.queue = []
    if (existsSync(this.threadsFile)) {
      for (const line of readFileSync(this.threadsFile, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const t = JSON.parse(line) as ThreadMetadata
          if (t?.threadId) this.threads.set(t.threadId, t)
        } catch { /* skip bad lines */ }
      }
    }
    if (existsSync(this.queueFile)) {
      for (const line of readFileSync(this.queueFile, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const q = JSON.parse(line) as QueuedSubmission
          if (q?.threadId) this.queue.push(q)
        } catch { /* skip bad lines */ }
      }
    }
  }

  private append(file: string, obj: object) {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8')
  }

  create(meta: Omit<ThreadMetadata, 'createdAt'>): ThreadMetadata {
    const full: ThreadMetadata = { ...meta, createdAt: Date.now() }
    this.threads.set(full.threadId, full)
    this.append(this.threadsFile, full)
    return full
  }

  get(threadId: string): ThreadMetadata | null {
    return this.threads.get(threadId) ?? null
  }

  listByProject(project: string): ThreadMetadata[] {
    return [...this.threads.values()]
      .filter((t) => t.project === project)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  queueSubmission(sub: QueuedSubmission): void {
    this.queue.push(sub)
    this.append(this.queueFile, sub)
  }

  drainQueue(threadId: string): QueuedSubmission[] {
    const drained = this.queue.filter((s) => s.threadId === threadId)
    this.queue = this.queue.filter((s) => s.threadId !== threadId)
    this.rewriteQueue()
    return drained
  }

  private rewriteQueue() {
    mkdirSync(dirname(this.queueFile), { recursive: true })
    const body = this.queue.map((q) => JSON.stringify(q)).join('\n')
    writeFileSync(this.queueFile, body ? body + '\n' : '', 'utf8')
  }
}

/** Injection seam: a file path selects the durable JSONL backend; default memory. */
export function createThreadStore(opts: { file?: string } = {}): ThreadStore {
  return opts.file ? new JsonlFileThreadStore(opts.file) : new InMemoryThreadStore()
}
