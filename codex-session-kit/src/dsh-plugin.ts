// dsh plugin entry for codex-session-kit (from openai/codex rollout formats, Apache-2.0)
// Tools: import/inspect codex session rollouts; append-only key/value memory.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { listSessions, parseRolloutFile, toDshEvents, MemoryStore } from './index.js';

export const name = 'codex-session-kit'
export const inject = ['tools']

function asRecord(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {} }

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const cfg = asRecord(config)
  const memoryPath = typeof cfg.memoryPath === 'string' && cfg.memoryPath
    ? cfg.memoryPath
    : join(homedir(), '.dsh', 'codex-memory.jsonl')
  let memory
  try { memory = new MemoryStore(memoryPath) } catch { memory = null }
  const defineTool = (d) => d

  ctx.tools.register(defineTool({
    name: 'codex_session_import',
    description: 'List and parse openai/codex session rollout files (*.jsonl): headers, items, malformed-line counts, normalized dsh event shapes.',
    parameters: {
      dir: { type: 'string', description: 'directory containing *.jsonl rollouts (lists files)' },
      path: { type: 'string', description: 'single rollout file to parse in detail' },
      maxItems: { type: 'number', description: 'cap returned items per file (default 50)' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const maxItems = Number(args?.maxItems ?? 50)
      if (typeof args?.path === 'string' && args.path) {
        const parsed = parseRolloutFile(String(args.path))
        return JSON.stringify({
          file: args.path,
          header: parsed.header,
          itemCount: parsed.items.length,
          badLines: parsed.badLines,
          events: toDshEvents(parsed.items).slice(0, maxItems),
        }, null, 2)
      }
      const dir = String(args?.dir ?? join(homedir(), '.codex', 'sessions'))
      return JSON.stringify({ dir, sessions: listSessions(dir).slice(0, maxItems) }, null, 2)
    },
    timeoutMs: 10000,
  }))

  ctx.tools.register(defineTool({
    name: 'codex_memory',
    description: 'Persistent key/value memory backed by an append-only JSONL log (survives restarts). Actions: get/set/delete/list.',
    parameters: {
      action: { type: 'string', required: true, enum: ['get', 'set', 'delete', 'list'] },
      key: { type: 'string', description: 'memory key (required for get/set/delete)' },
      value: { type: 'string', description: 'value to store (set only)' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      if (!memory) return JSON.stringify({ error: 'memory store unavailable at ' + memoryPath })
      const action = String(args?.action ?? 'list')
      if (action === 'list') return JSON.stringify({ path: memoryPath, keys: memory.keys() }, null, 2)
      const key = String(args?.key ?? '')
      if (!key) return JSON.stringify({ error: 'key required for ' + action })
      if (action === 'set') { memory.set(key, args?.value ?? null); return JSON.stringify({ ok: true, key }) }
      if (action === 'get') return JSON.stringify({ key, value: memory.get(key), exists: memory.has(key) })
      memory.delete(key); return JSON.stringify({ ok: true, deleted: key })
    },
    timeoutMs: 3000,
  }))
}

export { listSessions, parseRolloutFile, toDshEvents, MemoryStore }
