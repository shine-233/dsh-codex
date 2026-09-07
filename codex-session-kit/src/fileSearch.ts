// Distilled from openai/codex file-search (Apache-2.0, rust-v0.153.4):
// recursive file search producing scored FileMatches. The upstream CLI runs a
// parallel walk with gitignore awareness; this distillation keeps the match
// face (basename scoring via subsequence, path hits) over a synchronous walk.
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface FileMatch {
  score: number
  path: string
  matchType: 'basename' | 'path'
  root: string
  indices?: number[]
}

function subsequenceScore(name: string, query: string): { score: number; indices: number[] } | null {
  const lowerName = name.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const indices: number[] = []
  let cursor = 0
  let score = 0
  for (const qc of lowerQuery) {
    let found = -1
    while (cursor < lowerName.length) {
      if (lowerName[cursor] === qc) { found = cursor; break }
      cursor++
    }
    if (found === -1) return null
    indices.push(found)
    score += 1
    cursor++
  }
  // exact-name and prefix bonuses
  if (lowerName === lowerQuery) score += 100
  else if (lowerName.startsWith(lowerQuery)) score += 50
  return { score, indices }
}

/** Walk `root` collecting up to `limit` scored matches for `query`. */
export function searchFiles(root: string, query: string, limit = 20): FileMatch[] {
  const matches: FileMatch[] = []
  if (!query) return matches
  const walk = (dir: string) => {
    if (matches.length >= limit * 3) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const hit = subsequenceScore(entry.name, query)
      if (!hit) continue
      matches.push({
        score: hit.score + (entry.name === query ? 100 : 0),
        path: full,
        matchType: 'basename',
        root,
        indices: hit.indices,
      })
    }
  }
  walk(root)
  return matches
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((m) => ({ ...m, path: relative(root, m.path) || m.path }))
}
