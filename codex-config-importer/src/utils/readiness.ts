// Distilled from openai/codex utils/readiness (Apache-2.0, rust-v0.153.4):
// token-based readiness tracking — a producer marks a token ready, consumers
// wait for all outstanding tokens (upstream uses tokio watch; this distillation
// uses an event-emitter-free promise table with a lock timeout).
export class Readiness {
  private nextToken = 0
  private ready = new Set<number>()
  private waiters: (() => void)[] = []

  /** Acquire a token representing not-yet-ready work. */
  acquireToken(): number {
    return ++this.nextToken
  }

  isReady(): boolean {
    return this.outstanding() === 0
  }

  private outstanding(): number {
    let n = 0
    for (let t = 1; t <= this.nextToken; t++) if (!this.ready.has(t)) n++
    return n
  }

  /** Mark a token ready; returns true when everything is now ready. */
  markReady(token: number): boolean {
    this.ready.add(token)
    if (this.outstanding() === 0) {
      const waiters = this.waiters.splice(0)
      waiters.forEach((w) => w())
      return true
    }
    return false
  }

  /** Resolve when no outstanding tokens remain. */
  waitReady(): Promise<void> {
    if (this.outstanding() === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}
