// dsh-codex/codex-prompts/src/index.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
function listTemplates() {
  const out = [];
  const walk = (dir, pre) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, pre ? pre + "/" + e : e);
      else if (e.endsWith(".md")) out.push(pre ? pre + "/" + e : e);
    }
  };
  walk(ROOT, "");
  return out.sort();
}
function loadTemplate(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}
function buildSystemPrompt(relPaths, vars = {}) {
  return relPaths.map((p) => loadTemplate(p)).join("\n\n").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "{{" + k + "}}");
}

// dsh-codex/codex-prompts/src/dsh-plugin.ts
var name = "codex-prompts";
var inject = ["tools"];
function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return;
  const defineTool = (d) => d;
  ctx.tools.register(defineTool({
    name: "codex_prompts",
    description: "Vendored openai/codex prompt templates. Actions: list all templates, get one raw template, or build a system prompt from several with {{var}} substitution.",
    parameters: {
      action: { type: "string", required: true, enum: ["list", "get", "build"] },
      path: { type: "string", description: "template path for action=get" },
      paths: { type: "array", description: "template paths for action=build" },
      vars: { type: "object", description: "{{key}} substitutions for action=build" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      const action = String(args?.action ?? "list");
      if (action === "list") return JSON.stringify(listTemplates(), null, 2);
      if (action === "get") return loadTemplate(String(args?.path ?? ""));
      const paths = Array.isArray(args?.paths) ? args.paths.map(String) : [];
      if (!paths.length) return JSON.stringify({ error: "paths required for build" });
      return buildSystemPrompt(paths, args?.vars && typeof args.vars === "object" ? args.vars : {});
    },
    timeoutMs: 5e3
  }));
}
export {
  apply,
  buildSystemPrompt,
  inject,
  listTemplates,
  loadTemplate,
  name
};
