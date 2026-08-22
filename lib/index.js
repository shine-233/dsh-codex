// dsh-codex/codex-config-importer/src/dsh-plugin.ts
import { join } from "node:path";
import { homedir } from "node:os";

// dsh-codex/codex-config-importer/src/tomlImporter.ts
import { existsSync, readFileSync } from "node:fs";
function parseTomlLite(src) {
  const out = {};
  let section = out;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = out;
      for (const part of sec[1].split(".")) section = section[part] ||= {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) v = v.slice(1, -1);
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v.startsWith("[")) v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    section[kv[1]] = v;
  }
  return out;
}
function tomlToCordisPatch(cfgPath) {
  if (!existsSync(cfgPath)) return null;
  const cfg = parseTomlLite(readFileSync(cfgPath, "utf8"));
  const lines = [];
  const model = cfg["model"];
  const provider = cfg["model_provider"];
  if (model || provider) lines.push("- insert:");
  if (provider) lines.push(`  - id: llm-route
    config:
      model: ${JSON.stringify(model ?? "")}
      providerHint: ${JSON.stringify(provider)}`);
  const mp = cfg["model_providers"];
  if (mp && typeof mp === "object" && !Array.isArray(mp)) {
    for (const [pid, pv] of Object.entries(mp)) {
      const base = pv?.base_url ?? "";
      if (base) lines.push(`  - id: llm-provider-${pid}
    config:
      baseURL: ${JSON.stringify(base)}`);
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "# codex config had no mappable keys\n";
}

// dsh-codex/codex-config-importer/src/dsh-plugin.ts
var name = "codex-config-importer";
var inject = ["tools"];
function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return;
  const cfg = config && typeof config === "object" ? config : {};
  const defineTool = (d) => d;
  ctx.tools.register(defineTool({
    name: "codex_config_import",
    description: "Read an openai/codex config.toml and emit an equivalent dsh cordis.patch.yml overlay (llm route + provider wiring). Read-only: returns YAML text.",
    parameters: {
      configPath: { type: "string", description: "path to codex config.toml; defaults to ~/.codex/config.toml" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      const p = String(args?.configPath ?? join(homedir(), ".codex", "config.toml"));
      const yml = tomlToCordisPatch(p);
      if (!yml) return JSON.stringify({ error: `config not found or nothing to migrate: ${p}` });
      return yml;
    },
    timeoutMs: 5e3
  }));
}
export {
  apply,
  inject,
  name,
  tomlToCordisPatch
};
