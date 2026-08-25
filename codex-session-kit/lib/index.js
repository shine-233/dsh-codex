// dsh-codex/codex-session-kit/src/dsh-plugin.ts
import { join as join2 } from "node:path";
import { homedir } from "node:os";

// dsh-codex/codex-session-kit/src/index.ts
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// dsh-codex/codex-session-kit/src/sessionIndex.ts
import { createRequire } from "node:module";
var req = createRequire(import.meta.url);

// dsh-codex/codex-session-kit/src/index.ts
function listSessions(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const full = join(dir, f);
    let id;
    try {
      const first = readFileSync(full, "utf8").split("\n")[0];
      const j = JSON.parse(first);
      id = j?.payload?.id ?? j?.id;
    } catch {
    }
    out.push({ file: full, id, sizeBytes: statSync(full).size });
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
}
function parseRolloutFile(path) {
  const text = readFileSync(path, "utf8");
  return parseRolloutText(text);
}
function parseRolloutText(text) {
  let header = null;
  const items = [];
  let badLines = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (!header && (j?.type === "session_header" || j?.type === "session_meta")) header = j;
      else items.push(j);
    } catch {
      badLines++;
    }
  }
  return { header, items, badLines };
}
function toDshEvents(items) {
  return items.map((i) => ({ type: String(i?.type ?? "unknown"), payload: i }));
}
var MemoryStore = class {
  constructor(filePath) {
    this.filePath = filePath;
    this.rebuild();
  }
  filePath;
  state = /* @__PURE__ */ new Map();
  rebuild() {
    this.state.clear();
    if (!existsSync(this.filePath)) return;
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const op = JSON.parse(line);
        if (op.op === "set") this.state.set(op.key, op.value);
        if (op.op === "del") this.state.delete(op.key);
      } catch {
      }
    }
  }
  log(op) {
    if (!existsSync(join(this.filePath, ".."))) mkdirSync(join(this.filePath, ".."), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(op) + "\n", { flag: "a" });
  }
  set(key, value) {
    this.log({ op: "set", key, value, ts: Date.now() });
    this.state.set(key, value);
  }
  get(key) {
    return this.state.get(key);
  }
  has(key) {
    return this.state.has(key);
  }
  delete(key) {
    this.log({ op: "del", key, ts: Date.now() });
    this.state.delete(key);
  }
  keys() {
    return [...this.state.keys()];
  }
};

// dsh-codex/codex-session-kit/src/dsh-plugin.ts
var name = "codex-session-kit";
var inject = ["tools"];
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return;
  const cfg = asRecord(config);
  const memoryPath = typeof cfg.memoryPath === "string" && cfg.memoryPath ? cfg.memoryPath : join2(homedir(), ".dsh", "codex-memory.jsonl");
  let memory;
  try {
    memory = new MemoryStore(memoryPath);
  } catch {
    memory = null;
  }
  const defineTool = (d) => d;
  ctx.tools.register(defineTool({
    name: "codex_session_import",
    description: "List and parse openai/codex session rollout files (*.jsonl): headers, items, malformed-line counts, normalized dsh event shapes.",
    parameters: {
      dir: { type: "string", description: "directory containing *.jsonl rollouts (lists files)" },
      path: { type: "string", description: "single rollout file to parse in detail" },
      maxItems: { type: "number", description: "cap returned items per file (default 50)" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      const maxItems = Number(args?.maxItems ?? 50);
      if (typeof args?.path === "string" && args.path) {
        const parsed = parseRolloutFile(String(args.path));
        return JSON.stringify({
          file: args.path,
          header: parsed.header,
          itemCount: parsed.items.length,
          badLines: parsed.badLines,
          events: toDshEvents(parsed.items).slice(0, maxItems)
        }, null, 2);
      }
      const dir = String(args?.dir ?? join2(homedir(), ".codex", "sessions"));
      return JSON.stringify({ dir, sessions: listSessions(dir).slice(0, maxItems) }, null, 2);
    },
    timeoutMs: 1e4
  }));
  ctx.tools.register(defineTool({
    name: "codex_memory",
    description: "Persistent key/value memory backed by an append-only JSONL log (survives restarts). Actions: get/set/delete/list.",
    parameters: {
      action: { type: "string", required: true, enum: ["get", "set", "delete", "list"] },
      key: { type: "string", description: "memory key (required for get/set/delete)" },
      value: { type: "string", description: "value to store (set only)" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      if (!memory) return JSON.stringify({ error: "memory store unavailable at " + memoryPath });
      const action = String(args?.action ?? "list");
      if (action === "list") return JSON.stringify({ path: memoryPath, keys: memory.keys() }, null, 2);
      const key = String(args?.key ?? "");
      if (!key) return JSON.stringify({ error: "key required for " + action });
      if (action === "set") {
        memory.set(key, args?.value ?? null);
        return JSON.stringify({ ok: true, key });
      }
      if (action === "get") return JSON.stringify({ key, value: memory.get(key), exists: memory.has(key) });
      memory.delete(key);
      return JSON.stringify({ ok: true, deleted: key });
    },
    timeoutMs: 3e3
  }));
}
export {
  MemoryStore,
  apply,
  inject,
  listSessions,
  name,
  parseRolloutFile,
  toDshEvents
};
