// Distilled from openai/codex utils/stream-parser (Apache-2.0,
// rust-v0.153.4): incremental line-delimited JSON stream reader that yields
// parsed items and tolerates split chunks (a JSON object may arrive across
// multiple chunks) and bad lines (counted, not fatal).
export class StreamParser<T = unknown> {
  private buffer = ''
  readonly items: T[] = []
  readonly badLines: string[] = []

  constructor(private parseLine: (line: string) => T = (l) => JSON.parse(l) as T) {}

  /** Feed a chunk (any split point); returns the items completed by it. */
  push(chunk: string): T[] {
    this.buffer += chunk
    const produced: T[] = []
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) continue
      try { produced.push(this.parseLine(line)) } catch (e) { this.badLines.push(line) }
    }
    this.items.push(...produced)
    return produced
  }

  /** Feed a whole text; convenience over push. */
  static parseAll<T>(text: string, parseLine?: (line: string) => T): { items: T[]; badLines: string[] } {
    const p = new StreamParser<T>(parseLine)
    p.push(text)
    return { items: p.items, badLines: p.badLines }
  }
}
