// src/dsh-plugin.ts
import { join as join4 } from "node:path";
import { homedir } from "node:os";

// src/index.ts
import { readFileSync as readFileSync3, readdirSync as readdirSync3, statSync as statSync3, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join as join3 } from "node:path";

// src/sanitizedGitUrl.ts
var INVALID_GIT_REMOTE_URL = "invalid git remote URL";
var HELPER_TRANSPORT = /^[A-Za-z0-9+.-]+$/;
var InvalidGitRemoteUrlError = class extends Error {
  constructor() {
    super(INVALID_GIT_REMOTE_URL);
    this.name = "InvalidGitRemoteUrlError";
  }
};
function invalid() {
  throw new InvalidGitRemoteUrlError();
}
function splitRemoteHelpers(value) {
  let offset = 0;
  while (true) {
    const separator = value.indexOf("::", offset);
    if (separator < 0) break;
    const transport = value.slice(offset, separator);
    if (!transport || !HELPER_TRANSPORT.test(transport)) break;
    offset = separator + 2;
  }
  const address = value.slice(offset);
  if (offset > 0 && /\s/.test(address)) invalid();
  return { prefix: value.slice(0, offset), address };
}
function sanitizeStandardUrl(prefix, address) {
  const schemeEnd = address.indexOf("://");
  if (schemeEnd < 1) return void 0;
  const scheme = address.slice(0, schemeEnd);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) invalid();
  const authorityStart = schemeEnd + 3;
  const pathStart = address.indexOf("/", authorityStart);
  const authorityEnd = pathStart < 0 ? address.length : pathStart;
  const authority = address.slice(authorityStart, authorityEnd);
  if (!authority || /\s/.test(authority)) invalid();
  const at = authority.lastIndexOf("@");
  if (at < 0) return `${prefix}${address}`;
  const userInfo = authority.slice(0, at);
  const host = authority.slice(at + 1);
  if (!host || host.includes("@") || /[\[\]]/.test(host) && !/^\[[^\]]+\](?::\d+)?$/.test(host)) invalid();
  const username = userInfo.split(":", 1)[0];
  const preserveGit = scheme.toLowerCase() === "ssh" && username === "git";
  const retainedUser = preserveGit ? "git@" : "";
  return `${prefix}${scheme}://${retainedUser}${host}${address.slice(authorityEnd)}`;
}
function sanitizeScpRemote(prefix, address) {
  if (!address || /^\s|\s$/.test(address)) invalid();
  const at = address.indexOf("@");
  if (at >= 0) {
    const username = address.slice(0, at);
    const hostAndPath = address.slice(at + 1);
    if (!username || !hostAndPath) invalid();
    const separator2 = hostAndPath.startsWith("[") ? hostAndPath.indexOf("]:") + 1 : hostAndPath.indexOf(":");
    if (separator2 <= 0 || !hostAndPath.slice(separator2 + 1)) invalid();
    return `${prefix}${username === "git" ? "git@" : ""}${hostAndPath}`;
  }
  const separator = address.startsWith("[") ? address.indexOf("]:") + 1 : address.indexOf(":");
  if (separator <= 0 || !address.slice(separator + 1)) invalid();
  return `${prefix}${address}`;
}
function sanitizeGitRemoteUrl(value) {
  const { prefix, address } = splitRemoteHelpers(value);
  return sanitizeStandardUrl(prefix, address) ?? sanitizeScpRemote(prefix, address);
}
function sanitizeOptionalGitRemoteUrl(value) {
  if (typeof value !== "string") return void 0;
  try {
    return sanitizeGitRemoteUrl(value);
  } catch {
    return void 0;
  }
}

// src/sessionIndex.ts
import { createRequire } from "node:module";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
var JsSessionStore = class {
  rows = [];
  constructor(_dbPath) {
  }
  upsert(r) {
    const i = this.rows.findIndex((x) => x.file === r.file);
    if (i >= 0) this.rows[i] = r;
    else this.rows.push(r);
  }
  search(q) {
    const needle = q.toLowerCase();
    return this.rows.filter(
      (x) => (x.id ?? "").toLowerCase().includes(needle) || x.file.toLowerCase().includes(needle) || (x.cwd ?? "").toLowerCase().includes(needle)
    ).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0).map(({ id, file, cwd, originator }) => ({ id, cwd, originator, file }));
  }
  count() {
    return this.rows.length;
  }
  close() {
  }
};
var SqliteSessionStore = class {
  db;
  constructor(dbPath) {
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req("node:sqlite");
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, file TEXT UNIQUE, cwd TEXT, originator TEXT, size_bytes INTEGER)`
    );
  }
  upsert(r) {
    this.db.prepare(
      `INSERT INTO sessions(id,file,cwd,originator,size_bytes) VALUES(?,?,?,?,?)
         ON CONFLICT(file) DO UPDATE SET id=excluded.id, cwd=excluded.cwd,
         originator=excluded.originator, size_bytes=excluded.size_bytes`
    ).run(r.id, r.file, r.cwd, r.originator, r.size);
  }
  search(q) {
    const rows = this.db.prepare(
      `SELECT id,file,cwd,originator FROM sessions
         WHERE id LIKE ? OR file LIKE ? OR IFNULL(cwd,'') LIKE ? ORDER BY file`
    ).all("%" + q + "%", "%" + q + "%", "%" + q + "%");
    return rows.map((r) => ({
      id: r.id ?? null,
      file: r.file,
      cwd: r.cwd ?? null,
      originator: r.originator ?? null
    }));
  }
  count() {
    return this.db.prepare("SELECT COUNT(*) c FROM sessions").all()[0]?.c ?? 0;
  }
  close() {
    this.db.close();
  }
};
function createStore(dbPath) {
  try {
    return new SqliteSessionStore(dbPath);
  } catch {
    return new JsSessionStore(dbPath);
  }
}
var SessionIndex = class {
  store;
  constructor(dbPath) {
    this.store = createStore(dbPath);
  }
  /** Rebuild the mirror from a sessions directory (idempotent upserts). */
  rebuildFrom(dir) {
    let n = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const file = join(dir, f);
      let id = null, cwd = null, originator = null;
      try {
        const headerLine = readFileSync(file, "utf8").split("\n")[0];
        const j = JSON.parse(headerLine);
        id = j?.payload?.id ?? j?.id ?? null;
        cwd = j?.payload?.cwd ?? j?.cwd ?? null;
        originator = j?.payload?.originator ?? null;
      } catch {
      }
      const size = statSync(file).size;
      this.store.upsert({ id, file, cwd, originator, size });
      n++;
    }
    return n;
  }
  search(q) {
    return this.store.search(q);
  }
  count() {
    return this.store.count();
  }
  /** Release the underlying store (e.g. close the sqlite connection). */
  close() {
    this.store.close();
  }
};

// src/claudeCode.ts
import { readFileSync as readFileSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { join as join2 } from "node:path";
function listClaudeProjects(claudeHome) {
  const projDir = join2(claudeHome, "projects");
  try {
    return readdirSync2(projDir).map((p) => join2(projDir, p)).filter((p) => statSync2(p).isDirectory());
  } catch {
    return [];
  }
}
function listClaudeSessions(projectDir) {
  try {
    return readdirSync2(projectDir).filter((f) => f.endsWith(".jsonl")).map((f) => join2(projectDir, f));
  } catch {
    return [];
  }
}
function parseClaudeSession(path) {
  const turns = [];
  let skipped = 0;
  for (const line of readFileSync2(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const msg = j?.message;
      const text = Array.isArray(msg?.content) ? msg.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : typeof msg?.content === "string" ? msg.content : "";
      if (!text) {
        skipped++;
        continue;
      }
      turns.push({ role: j.type === "assistant" ? "assistant" : "user", text, ts: j.timestamp });
    } catch {
      skipped++;
    }
  }
  return { turns, skipped };
}
function claudeToDshEvents(turns) {
  return turns.map((t) => ({
    type: t.role === "assistant" ? "agent_message" : "user_message",
    payload: { text: t.text, ts: t.ts, source: "claude-code" }
  }));
}

// src/index.ts
function sanitizeRolloutHeader(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const header = value;
  const payload = header.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return value;
  const gitKey = payload.git && typeof payload.git === "object" && !Array.isArray(payload.git) ? "git" : payload.git_info && typeof payload.git_info === "object" && !Array.isArray(payload.git_info) ? "git_info" : void 0;
  if (!gitKey) return value;
  const git = payload[gitKey];
  if (!Object.prototype.hasOwnProperty.call(git, "repository_url")) return value;
  const repositoryUrl = sanitizeOptionalGitRemoteUrl(git.repository_url);
  const sanitizedGit = { ...git };
  if (repositoryUrl === void 0) delete sanitizedGit.repository_url;
  else sanitizedGit.repository_url = repositoryUrl;
  return { ...header, payload: { ...payload, [gitKey]: sanitizedGit } };
}
function listSessions(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync3(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const full = join3(dir, f);
    let id;
    try {
      const first = readFileSync3(full, "utf8").split("\n")[0];
      const j = JSON.parse(first);
      id = j?.payload?.id ?? j?.id;
    } catch {
    }
    out.push({ file: full, id, sizeBytes: statSync3(full).size });
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
}
function parseRolloutFile(path) {
  const text = readFileSync3(path, "utf8");
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
      if (!header && (j?.type === "session_header" || j?.type === "session_meta")) {
        header = sanitizeRolloutHeader(j);
      } else items.push(j);
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
  state = /* @__PURE__ */ new Map();
  rebuild() {
    this.state.clear();
    if (!existsSync(this.filePath)) return;
    for (const line of readFileSync3(this.filePath, "utf8").split("\n")) {
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
    if (!existsSync(join3(this.filePath, ".."))) mkdirSync(join3(this.filePath, ".."), { recursive: true });
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
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
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
      for (const line of readFileSync4(filePath, "utf8").split("\n").filter(Boolean)) {
        try {
          this.replay(JSON.parse(line));
        } catch {
        }
      }
    }
  }
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
function isToolHost(v) {
  const tools = asRecord(asRecord(v).tools);
  return typeof tools.register === "function";
}
function apply(ctx, config = {}) {
  if (!isToolHost(ctx)) return;
  const cfg = asRecord(config);
  const memoryPath = typeof cfg.memoryPath === "string" && cfg.memoryPath ? cfg.memoryPath : join4(homedir(), ".dsh", "codex-memory.jsonl");
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
      const input = asRecord(args);
      const maxItems = Number(input.maxItems ?? 50);
      if (typeof input.path === "string" && input.path) {
        const parsed = parseRolloutFile(input.path);
        return JSON.stringify({
          file: input.path,
          header: parsed.header,
          itemCount: parsed.items.length,
          badLines: parsed.badLines,
          events: toDshEvents(parsed.items).slice(0, maxItems)
        }, null, 2);
      }
      const dir = String(input.dir ?? join4(homedir(), ".codex", "sessions"));
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
      const input = asRecord(args);
      if (!memory) return JSON.stringify({ error: "memory store unavailable at " + memoryPath });
      const action = String(input.action ?? "list");
      if (action === "list") return JSON.stringify({ path: memoryPath, keys: memory.keys() }, null, 2);
      const key = String(input.key ?? "");
      if (!key) return JSON.stringify({ error: "key required for " + action });
      if (action === "set") {
        memory.set(key, input.value ?? null);
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
  InvalidGitRemoteUrlError,
  MAX_ENVIRONMENT_SUBAGENTS,
  MAX_ENVIRONMENT_SUBAGENT_BYTES,
  MemoryStore,
  SessionIndex,
  apply,
  claudeToDshEvents,
  inject,
  listClaudeProjects,
  listClaudeSessions,
  listSessions,
  name,
  parseClaudeSession,
  parseRolloutFile,
  parseRolloutText,
  sanitizeGitRemoteUrl,
  sanitizeOptionalGitRemoteUrl,
  toDshEvents
};
