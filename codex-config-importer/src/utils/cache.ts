// Port of openai/codex utils/cache BlockingLruCache (Apache-2.0, rust-v0.153.4):
// capacity-bounded LRU with get_or_insert_with. JS is single-threaded here, so
// the "blocking" dedupe upstream does under a mutex becomes a promise-aware
// entry: concurrent get_or_insert_with for the same key shares one promise.
export class BlockingLruCache<K, V> {
  private capacity: number
  private map = new Map<K, V>()
  private inflight = new Map<K, Promise<V>>()

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('capacity must be >= 1')
    this.capacity = capacity
  }

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) this.touch(key, v)
    return v
  }

  private touch(key: K, v: V): void {
    this.map.delete(key)
    this.map.set(key, v)
  }

  getOrInsertWith(key: K, make: () => V): V {
    const existing = this.get(key)
    if (existing !== undefined) return existing
    const value = make()
    this.set(key, value)
    return value
  }

  async getOrInsertWithAsync(key: K, make: () => Promise<V>): Promise<V> {
    const existing = this.get(key)
    if (existing !== undefined) return existing
    const inflight = this.inflight.get(key)
    if (inflight) return inflight
    const promise = make().then((v) => {
      this.set(key, v)
      this.inflight.delete(key)
      return v
    })
    this.inflight.set(key, promise)
    return promise
  }

  set(key: K, v: V): void {
    if (this.map.has(key)) this.touch(key, v)
    else {
      this.map.set(key, v)
      if (this.map.size > this.capacity) {
        const oldest = this.map.keys().next().value
        if (oldest !== undefined) this.map.delete(oldest)
      }
    }
  }
}
