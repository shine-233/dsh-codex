// Dynamic skill selector, distilled from openai/codex ext/skills selection
// (Apache-2.0, anchor rust-v0.153.4): resolve alias references and rank
// skills against a free-text query. Upstream keeps an alias table + lexical
// scorer backed by the model; this distillation preserves the contract
// (resolveAlias + selectSkills) with deterministic ordering and zero native
// deps, suitable for dsh's stateless tool seam.
import type { SkillEntry } from './index.js'

export interface SkillWithAliases extends SkillEntry {
  aliases?: string[]
}

export interface SelectOptions {
  /** Max skills to return. Default 5. */
  limit?: number
  /** Drop skills scoring below this. Default 0 (keep any positive match). */
  minScore?: number
}

/** Normalize a token: lowercase, collapse non-alphanumerics to single spaces. */
export function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Build an alias -> canonical-name lookup from skill declarations. */
export function buildAliasIndex(skills: SkillWithAliases[]): Map<string, string> {
  const idx = new Map<string, string>()
  for (const s of skills) {
    const canon = s.name
    const n = normalizeToken(canon)
    if (n) idx.set(n, canon)
    for (const a of s.aliases ?? []) {
      const na = normalizeToken(a)
      if (na) idx.set(na, canon)
    }
  }
  return idx
}

/**
 * Resolve a single reference token to a canonical skill name. Exact
 * alias/name hit first, then prefix/contains fallback. Returns null when no
 * skill matches.
 */
export function resolveAlias(token: string, index: Map<string, string>): string | null {
  const n = normalizeToken(token)
  if (!n) return null
  if (index.has(n)) return index.get(n) as string
  for (const [key, canon] of index) {
    if (key.startsWith(n) || n.startsWith(key)) return canon
  }
  return null
}

/**
 * Rank skills against a free-text query. Per query token the score is:
 *   +3 exact skill-name or alias match
 *   +2 token is a whole word within the skill name
 *   +1 token appears in the skill description
 *   +1 name-token prefix / substring overlap
 * Returns up to `limit` skills with score > 0 and >= minScore, sorted by score
 * descending then name ascending (deterministic).
 */
export function selectSkills(
  query: string,
  skills: SkillWithAliases[],
  opts: SelectOptions = {},
): SkillWithAliases[] {
  const limit = opts.limit ?? 5
  const minScore = opts.minScore ?? 0
  const qTokens = normalizeToken(query).split(' ').filter(Boolean)
  if (!qTokens.length) return []

  const scored = skills.map((s) => {
    const nameNorm = normalizeToken(s.name)
    const nameToks = nameNorm.split(' ').filter(Boolean)
    const descToks = new Set(normalizeToken(s.description).split(' ').filter(Boolean))
    const aliasNorms = (s.aliases ?? []).map(normalizeToken)
    let score = 0
    for (const q of qTokens) {
      if (nameNorm === q || aliasNorms.includes(q)) score += 3
      else if (nameToks.includes(q)) score += 2
      else if (descToks.has(q)) score += 1
      else if (nameToks.some((t) => t.startsWith(q) || q.startsWith(t))) score += 1
    }
    return { s, score }
  })

  return scored
    .filter((x) => x.score > 0 && x.score >= minScore)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s)
}
