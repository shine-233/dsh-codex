// src/dsh-plugin.ts
import { join as join2 } from "node:path";
import { homedir } from "node:os";

// src/index.ts
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

// src/agentGraph.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname } from "node:path";
var MAX_ENVIRONMENT_SUBAGENTS = 8;
var MAX_ENVIRONMENT_SUBAGENT_BYTES = 1024;
var ROSTER_WRAPPER_BYTES = Buffer.byteLength("  <subagents>\n  </subagents>\n");
function escapeXmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
var AgentGraphStore = class {
  constructor(filePath) {
    this.filePath = filePath;
    if (filePath && existsSync2(filePath)) {
      for (const line of readFileSync2(filePath, "utf8").split("\n").filter(Boolean)) {
        try {
          this.replay(JSON.parse(line));
        } catch {
        }
      }
    }
  }
  filePath;
  nodes = /* @__PURE__ */ new Map();
  edges = [];
  log = [];
  replay(op) {
    this.log.push(op);
    if (op.op === "node") this.nodes.set(op.agentId, op);
    if (op.op === "edge") this.edges.push(op);
    if (op.op === "edge-status") {
      for (let i = this.edges.length - 1; i >= 0; i--) {
        if (this.edges[i].childId === op.childId && this.edges[i].status === "running") {
          this.edges[i].status = op.status;
          break;
        }
      }
    }
  }
  persist(op) {
    if (!this.filePath) return;
    if (!existsSync2(this.filePath)) mkdirSync2(dirname(this.filePath), { recursive: true });
    writeFileSync2(this.filePath, JSON.stringify(op) + "\n", { flag: "a" });
  }
  addAgent(agentId, label, agentPath) {
    const node = { agentId, label, createdAt: Date.now(), ...agentPath ? { agentPath } : {} };
    this.nodes.set(agentId, node);
    this.persist({ op: "node", ...node });
    return node;
  }
  addSpawnEdge(parentId, childId, status = "running") {
    const edge = { parentId, childId, status };
    this.edges.push(edge);
    this.persist({ op: "edge", ...edge });
    return edge;
  }
  setEdgeStatus(childId, status) {
    for (let i = this.edges.length - 1; i >= 0; i--) {
      if (this.edges[i].childId === childId) {
        this.edges[i].status = status;
        break;
      }
    }
    this.persist({ op: "edge-status", childId, status });
  }
  /**
   * Render persisted direct children for multi-agent v2 environment context.
   * Loaded children sort first; both groups sort by full path. The returned
   * lines fit inside the upstream 8-agent / 1,024-byte roster envelope.
   */
  formatEnvironmentContextSubagents(parentId, loadedAgentIds) {
    const parentPath = this.nodes.get(parentId)?.agentPath;
    if (typeof parentPath !== "string") return "";
    const childPathPrefix = `${parentPath}/`;
    const loaded = new Set(loadedAgentIds);
    const childrenById = /* @__PURE__ */ new Map();
    for (const edge of this.childrenOf(parentId)) {
      const node = this.nodes.get(edge.childId);
      if (typeof node?.agentPath !== "string" || !node.agentPath.startsWith(childPathPrefix)) continue;
      const relativePath = node.agentPath.slice(childPathPrefix.length);
      if (relativePath && !relativePath.includes("/")) childrenById.set(node.agentId, node);
    }
    const children = [...childrenById.values()].sort((left, right) => {
      const loadedOrder = Number(!loaded.has(left.agentId)) - Number(!loaded.has(right.agentId));
      if (loadedOrder) return loadedOrder;
      if (left.agentPath < right.agentPath) return -1;
      if (left.agentPath > right.agentPath) return 1;
      return 0;
    });
    const lines = [];
    let renderedBytes = ROSTER_WRAPPER_BYTES;
    for (const child of children) {
      if (lines.length === MAX_ENVIRONMENT_SUBAGENTS) break;
      const line = `<agent name="${escapeXmlAttribute(child.agentPath)}" />`;
      const lineBytes = Buffer.byteLength(`    ${line}
`);
      if (renderedBytes + lineBytes <= MAX_ENVIRONMENT_SUBAGENT_BYTES) {
        renderedBytes += lineBytes;
        lines.push(line);
      }
    }
    return lines.join("\n");
  }
  childrenOf(agentId) {
    return this.edges.filter((e) => e.parentId === agentId);
  }
  nodeCount() {
    return this.nodes.size;
  }
  edgeCount() {
    return this.edges.length;
  }
};

// src/dsh-plugin.ts
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
  AgentGraphStore,
  MAX_ENVIRONMENT_SUBAGENTS,
  MAX_ENVIRONMENT_SUBAGENT_BYTES,
  MemoryStore,
  apply,
  inject,
  listSessions,
  name,
  parseRolloutFile,
  toDshEvents
};
