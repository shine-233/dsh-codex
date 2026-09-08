// dsh plugin entry for codex-skills-kit (budget math from openai/codex ext/skills render.rs)
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { catalogBudgetTokens, renderCatalog, selectSkills } from './index.js';
import type { SkillEntry } from './index.js';
import type { SkillWithAliases } from './selector.js';

export const name = 'codex-skills-kit'
export const inject = ['tools']

type UnknownRecord = Record<string, unknown>
type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: string; text: string }[]
  }
  execute: (args: unknown) => Promise<string>
  timeoutMs: number
}
type ToolHost = { tools: { register: (tool: ToolDefinition) => unknown } }

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function isToolHost(value: unknown): value is ToolHost {
  const tools = asRecord(asRecord(value).tools)
  return typeof tools.register === 'function'
}

function normalizeEntry(value: unknown): SkillWithAliases {
  const entry = asRecord(value)
  return {
    name: String(entry.name ?? '?'),
    description: String(entry.description ?? ''),
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map(String) : [],
  }
}

function explicitEntries(value: unknown): SkillWithAliases[] {
  return Array.isArray(value) ? value.map(normalizeEntry) : []
}

export function readSkillDir(dir: string): SkillEntry[] {
  if (!existsSync(dir)) return []
  const out: SkillEntry[] = []
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

export function apply(ctx: unknown, config: unknown = {}) {
  if (!isToolHost(ctx)) return
  const cfg = asRecord(config)
  const defineTool = <T extends ToolDefinition>(d: T): T => d
  ctx.tools.register(defineTool({
    name: 'codex_skill_catalog',
    description: 'Render a skill catalog under a context-token budget using the openai/codex budget math (2% of window, 10k hard cap, 8k fallback). Entries come from args or a directory of SKILL.md folders.',
    parameters: {
      dir: { type: 'string', description: 'directory whose subfolders each contain SKILL.md' },
      entries: { type: 'array', description: 'explicit [{name, description}] entries' },
      contextWindowTokens: { type: 'number', description: 'model context window for budget calc' },
      budgetChars: { type: 'number', description: 'override character budget directly' },
    },
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: v as string }] },
    async execute(args: unknown) {
      const input = asRecord(args)
      let entries: SkillWithAliases[] = explicitEntries(input.entries)
      if (!entries.length && typeof input.dir === 'string') entries = readSkillDir(input.dir)
      if (!entries.length && typeof cfg.catalogDir === 'string') entries = readSkillDir(cfg.catalogDir)
      const budget = typeof input.budgetChars === 'number' && Number.isFinite(input.budgetChars)
        ? Number(input.budgetChars)
        : catalogBudgetTokens(Number(input.contextWindowTokens ?? cfg.contextWindowTokens))
      const r = renderCatalog(entries, budget)
      return JSON.stringify({ budgetChars: budget, included: r.included, omitted: r.omitted, catalog: r.text }, null, 2)
    },
    timeoutMs: 5000,
  }))

  // Dynamic skill selector: alias resolution + lexical scoring against a query.
  ctx.tools.register(defineTool({
    name: 'codex_skill_select',
    description: 'Pick the most relevant skills for a free-text query using the openai/codex dynamic skill selector (alias resolution + lexical scoring).',
    parameters: {
      query: { type: 'string', description: 'free-text query describing the task' },
      dir: { type: 'string', description: 'directory whose subfolders each contain SKILL.md' },
      entries: { type: 'array', description: 'explicit [{name, description, aliases?}] entries' },
      limit: { type: 'number', description: 'max skills to return' },
    },
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: v as string }] },
    async execute(args: unknown) {
      const input = asRecord(args)
      let entries: SkillWithAliases[] = explicitEntries(input.entries)
      if (!entries.length && typeof input.dir === 'string') entries = readSkillDir(input.dir)
      if (!entries.length && typeof cfg.catalogDir === 'string') entries = readSkillDir(cfg.catalogDir)
      const picked = selectSkills(String(input.query ?? ''), entries, {
        limit: typeof input.limit === 'number' && Number.isFinite(input.limit) ? Number(input.limit) : 5,
      })
      return JSON.stringify({ selected: picked.map((s) => s.name) }, null, 2)
    },
    timeoutMs: 5000,
  }))
}

export { catalogBudgetTokens, renderCatalog, selectSkills }
