// Budget math ported from openai/codex ext/skills render.rs (Apache-2.0).
// Catalog prompt budget = configured cap OR 2% of context window, hard floor default 8000 chars.

export const HARD_CAP_TOKENS = 10000;
export const WINDOW_RATIO = 0.02;
export const FALLBACK_CHARS = 8000;
export const MAX_DESCRIPTION_CHARS = 1024;

/** Token budget for rendering the skill catalog into context. */
export function catalogBudgetTokens(contextWindowTokens?: number): number {
  if (!contextWindowTokens || contextWindowTokens <= 0) return FALLBACK_CHARS;
  return Math.min(HARD_CAP_TOKENS, Math.floor(contextWindowTokens * WINDOW_RATIO));
}

/** Truncate a single skill description to the upstream per-entry limit. */
export function truncateDescription(s: string, max: number = MAX_DESCRIPTION_CHARS): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export interface SkillEntry { name: string; description: string }

/** Render catalog entries under a character budget, dropping lowest-priority tails. */
export function renderCatalog(entries: SkillEntry[], budgetChars: number): {
  text: string; included: number; omitted: number } {
  const sorted = [...entries].sort((a,b)=>a.name.localeCompare(b.name));
  const out: string[] = []; let used = 0; let included = 0;
  for (const e of sorted) {
    const desc = truncateDescription(e.description);
    const line = `- ${e.name}: ${desc}`;
    if (used + line.length > budgetChars) continue;
    out.push(line); used += line.length + 1; included++;
  }
  return { text: out.join('\n'), included, omitted: sorted.length - included };
}
