// Distilled from openai/codex utils/git-discovery (Apache-2.0, rust-v0.153.4):
// bounded, shared git-root discovery. Upstream shares one outstanding probe per
// cwd and caps concurrent probes; this distillation keeps the sharing + cap
// semantics synchronously (share the memo while a walk is in flight).
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

const MAX_CONCURRENT_ROOT_PROBES = 8

const sharedProbes = new Map<string, string | null>()
let inFlight = 0

/** Walk up from `cwd` to the nearest directory containing `.git`. */
function probe(cwd: string): string | null {
  let dir = cwd
  while (true) {
    const dotGit = join(dir, '.git')
    if (existsSync(dotGit)) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Find the git root for `cwd` with per-cwd sharing and a bounded number of
 * concurrent probes. Returns null when no repo root is found or the probe cap
 * is exhausted (optional metadata must never block).
 */
export function findGitRoot(cwd: string): string | null {
  const key = cwd
  if (sharedProbes.has(key)) return sharedProbes.get(key) ?? null
  if (inFlight >= MAX_CONCURRENT_ROOT_PROBES) return null
  inFlight++
  try {
    const root = probe(cwd)
    sharedProbes.set(key, root)
    return root
  } finally {
    inFlight--
  }
}

/** Exposed for tests: probe cache state. */
export function probeCacheSize(): number {
  return sharedProbes.size
}
