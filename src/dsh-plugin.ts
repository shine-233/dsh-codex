// dsh plugin entry for codex-skills-kit (budget math from openai/codex ext/skills render.rs)
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { catalogBudgetTokens, renderCatalog } from './index.js';

export const name = 'codex-skills-kit'
export const inject = ['tools']

export function readSkillDir(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (!statSync(full).isDirectory()) continue
    const md = join(full, 'SKILL.md')
    if (!existsSync(md)) continue
    const text = readFileSync(md, 'utf8').slice(0, 4000)
    const nameM = text.match(/^name:\s*(.+)$/m)
    const descM = text.match(/^description:\s*(.+)$/m)
    out.push({ name: nameM?.[1]?.trim() ?? e, description: descM?.[1]?.trim() ?? '' })
  }
  return out
}

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const cfg = config && typeof config === 'object' ? config : {}
  const defineTool = (d) => d
  ctx.tools.register(defineTool({
    name: 'codex_skill_catalog',
    description: 'Render a skill catalog under a context-token budget using the openai/codex budget math (2% of window, 10k hard cap, 8k fallback). Entries come from args or a directory of SKILL.md folders.',
    parameters: {
      dir: { type: 'string', description: 'directory whose subfolders each contain SKILL.md' },
      entries: { type: 'array', description: 'explicit [{name, description}] entries' },
      contextWindowTokens: { type: 'number', description: 'model context window for budget calc' },
      budgetChars: { type: 'number', description: 'override character budget directly' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      let entries = Array.isArray(args?.entries) ? args.entries : []
      if (!entries.length && typeof args?.dir === 'string') entries = readSkillDir(String(args.dir))
      if (!entries.length && typeof cfg.catalogDir === 'string') entries = readSkillDir(cfg.catalogDir)
      const budget = Number.isFinite(args?.budgetChars) ? Number(args.budgetChars)
        : catalogBudgetTokens(Number(args?.contextWindowTokens ?? cfg.contextWindowTokens))
      const r = renderCatalog(entries.map((e) => ({ name: String(e?.name ?? '?'), description: String(e?.description ?? '') })), budget)
      return JSON.stringify({ budgetChars: budget, included: r.included, omitted: r.omitted, catalog: r.text }, null, 2)
    },
    timeoutMs: 5000,
  }))
}

export { catalogBudgetTokens, renderCatalog }
