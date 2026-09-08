// src/dsh-plugin.ts
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// src/selector.ts
function normalizeToken(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function selectSkills(query, skills, opts = {}) {
  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0;
  const qTokens = normalizeToken(query).split(" ").filter(Boolean);
  if (!qTokens.length) return [];
  const scored = skills.map((s) => {
    const nameNorm = normalizeToken(s.name);
    const nameToks = nameNorm.split(" ").filter(Boolean);
    const descToks = new Set(normalizeToken(s.description).split(" ").filter(Boolean));
    const aliasNorms = (s.aliases ?? []).map(normalizeToken);
    let score = 0;
    for (const q of qTokens) {
      if (nameNorm === q || aliasNorms.includes(q)) score += 3;
      else if (nameToks.includes(q)) score += 2;
      else if (descToks.has(q)) score += 1;
      else if (nameToks.some((t) => t.startsWith(q) || q.startsWith(t))) score += 1;
    }
    return { s, score };
  });
  return scored.filter((x) => x.score > 0 && x.score >= minScore).sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name)).slice(0, limit).map((x) => x.s);
}

// src/index.ts
var HARD_CAP_TOKENS = 1e4;
var WINDOW_RATIO = 0.02;
var FALLBACK_CHARS = 8e3;
var MAX_DESCRIPTION_CHARS = 1024;
function catalogBudgetTokens(contextWindowTokens) {
  if (!contextWindowTokens || contextWindowTokens <= 0) return FALLBACK_CHARS;
  return Math.min(HARD_CAP_TOKENS, Math.floor(contextWindowTokens * WINDOW_RATIO));
}
function truncateDescription(s, max = MAX_DESCRIPTION_CHARS) {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}
function renderCatalog(entries, budgetChars) {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  let used = 0;
  let included = 0;
  for (const e of sorted) {
    const desc = truncateDescription(e.description);
    const line = `- ${e.name}: ${desc}`;
    if (used + line.length > budgetChars) continue;
    out.push(line);
    used += line.length + 1;
    included++;
  }
  return { text: out.join("\n"), included, omitted: sorted.length - included };
}

// src/dsh-plugin.ts
var name = "codex-skills-kit";
var inject = ["tools"];
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function isToolHost(value) {
  const tools = asRecord(asRecord(value).tools);
  return typeof tools.register === "function";
}
function normalizeEntry(value) {
  const entry = asRecord(value);
  return {
    name: String(entry.name ?? "?"),
    description: String(entry.description ?? ""),
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map(String) : []
  };
}
function explicitEntries(value) {
  return Array.isArray(value) ? value.map(normalizeEntry) : [];
}
function readSkillDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (!statSync(full).isDirectory()) continue;
    const md = join(full, "SKILL.md");
    if (!existsSync(md)) continue;
    const text = readFileSync(md, "utf8").slice(0, 4e3);
    const nameM = text.match(/^name:\s*(.+)$/m);
    const descM = text.match(/^description:\s*(.+)$/m);
    out.push({ name: nameM?.[1]?.trim() ?? e, description: descM?.[1]?.trim() ?? "" });
  }
  return out;
}
function apply(ctx, config = {}) {
  if (!isToolHost(ctx)) return;
  const cfg = asRecord(config);
  const defineTool = (d) => d;
  ctx.tools.register(defineTool({
    name: "codex_skill_catalog",
    description: "Render a skill catalog under a context-token budget using the openai/codex budget math (2% of window, 10k hard cap, 8k fallback). Entries come from args or a directory of SKILL.md folders.",
    parameters: {
      dir: { type: "string", description: "directory whose subfolders each contain SKILL.md" },
      entries: { type: "array", description: "explicit [{name, description}] entries" },
      contextWindowTokens: { type: "number", description: "model context window for budget calc" },
      budgetChars: { type: "number", description: "override character budget directly" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      const input = asRecord(args);
      let entries = explicitEntries(input.entries);
      if (!entries.length && typeof input.dir === "string") entries = readSkillDir(input.dir);
      if (!entries.length && typeof cfg.catalogDir === "string") entries = readSkillDir(cfg.catalogDir);
      const budget = typeof input.budgetChars === "number" && Number.isFinite(input.budgetChars) ? Number(input.budgetChars) : catalogBudgetTokens(Number(input.contextWindowTokens ?? cfg.contextWindowTokens));
      const r = renderCatalog(entries, budget);
      return JSON.stringify({ budgetChars: budget, included: r.included, omitted: r.omitted, catalog: r.text }, null, 2);
    },
    timeoutMs: 5e3
  }));
  ctx.tools.register(defineTool({
    name: "codex_skill_select",
    description: "Pick the most relevant skills for a free-text query using the openai/codex dynamic skill selector (alias resolution + lexical scoring).",
    parameters: {
      query: { type: "string", description: "free-text query describing the task" },
      dir: { type: "string", description: "directory whose subfolders each contain SKILL.md" },
      entries: { type: "array", description: "explicit [{name, description, aliases?}] entries" },
      limit: { type: "number", description: "max skills to return" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      const input = asRecord(args);
      let entries = explicitEntries(input.entries);
      if (!entries.length && typeof input.dir === "string") entries = readSkillDir(input.dir);
      if (!entries.length && typeof cfg.catalogDir === "string") entries = readSkillDir(cfg.catalogDir);
      const picked = selectSkills(String(input.query ?? ""), entries, {
        limit: typeof input.limit === "number" && Number.isFinite(input.limit) ? Number(input.limit) : 5
      });
      return JSON.stringify({ selected: picked.map((s) => s.name) }, null, 2);
    },
    timeoutMs: 5e3
  }));
}
export {
  apply,
  catalogBudgetTokens,
  inject,
  name,
  readSkillDir,
  renderCatalog,
  selectSkills
};
