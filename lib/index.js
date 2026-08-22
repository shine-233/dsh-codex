// dsh-codex/codex-skills-kit/src/dsh-plugin.ts
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// dsh-codex/codex-skills-kit/src/index.ts
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

// dsh-codex/codex-skills-kit/src/dsh-plugin.ts
var name = "codex-skills-kit";
var inject = ["tools"];
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
  if (!ctx?.tools?.register) return;
  const cfg = config && typeof config === "object" ? config : {};
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
      let entries = Array.isArray(args?.entries) ? args.entries : [];
      if (!entries.length && typeof args?.dir === "string") entries = readSkillDir(String(args.dir));
      if (!entries.length && typeof cfg.catalogDir === "string") entries = readSkillDir(cfg.catalogDir);
      const budget = Number.isFinite(args?.budgetChars) ? Number(args.budgetChars) : catalogBudgetTokens(Number(args?.contextWindowTokens ?? cfg.contextWindowTokens));
      const r = renderCatalog(entries.map((e) => ({ name: String(e?.name ?? "?"), description: String(e?.description ?? "") })), budget);
      return JSON.stringify({ budgetChars: budget, included: r.included, omitted: r.omitted, catalog: r.text }, null, 2);
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
  renderCatalog
};
