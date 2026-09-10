// dsh plugin entry for codex-session-kit (from openai/codex rollout formats, Apache-2.0)
// Tools: import/inspect codex session rollouts; append-only key/value memory.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { listSessions, parseRolloutFile, toDshEvents, MemoryStore } from './index.js';
import { AgentGraphStore, MAX_ENVIRONMENT_SUBAGENTS, MAX_ENVIRONMENT_SUBAGENT_BYTES } from './agentGraph.js';

export const name = 'codex-session-kit'
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

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as UnknownRecord : {}
}

function isToolHost(v: unknown): v is ToolHost {
  const tools = asRecord(asRecord(v).tools)
  return typeof tools.register === 'function'
}

export function apply(ctx: unknown, config: unknown = {}) {
  if (!isToolHost(ctx)) return
  const cfg = asRecord(config)
  const memoryPath = typeof cfg.memoryPath === 'string' && cfg.memoryPath
    ? cfg.memoryPath
    : join(homedir(), '.dsh', 'codex-memory.jsonl')
  let memory: MemoryStore | null
  try { memory = new MemoryStore(memoryPath) } catch { memory = null }
  const defineTool = <T extends ToolDefinition>(d: T): T => d

  ctx.tools.register(defineTool({
    name: 'codex_session_import',
    description: 'List and parse openai/codex session rollout files (*.jsonl): headers, items, malformed-line counts, normalized dsh event shapes.',
    parameters: {
      dir: { type: 'string', description: 'directory containing *.jsonl rollouts (lists files)' },
      path: { type: 'string', description: 'single rollout file to parse in detail' },
      maxItems: { type: 'number', description: 'cap returned items per file (default 50)' },
    },
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: v as string }] },
    async execute(args: unknown) {
      const input = asRecord(args)
      const maxItems = Number(input.maxItems ?? 50)
      if (typeof input.path === 'string' && input.path) {
        const parsed = parseRolloutFile(input.path)
        return JSON.stringify({
          file: input.path,
          header: parsed.header,
          itemCount: parsed.items.length,
          badLines: parsed.badLines,
          events: toDshEvents(parsed.items).slice(0, maxItems),
        }, null, 2)
      }
      const dir = String(input.dir ?? join(homedir(), '.codex', 'sessions'))
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
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: v as string }] },
    async execute(args: unknown) {
      const input = asRecord(args)
      if (!memory) return JSON.stringify({ error: 'memory store unavailable at ' + memoryPath })
      const action = String(input.action ?? 'list')
      if (action === 'list') return JSON.stringify({ path: memoryPath, keys: memory.keys() }, null, 2)
      const key = String(input.key ?? '')
      if (!key) return JSON.stringify({ error: 'key required for ' + action })
      if (action === 'set') { memory.set(key, input.value ?? null); return JSON.stringify({ ok: true, key }) }
      if (action === 'get') return JSON.stringify({ key, value: memory.get(key), exists: memory.has(key) })
      memory.delete(key); return JSON.stringify({ ok: true, deleted: key })
    },
    timeoutMs: 3000,
  }))
}

export * from './index.js'
export { AgentGraphStore, MAX_ENVIRONMENT_SUBAGENTS, MAX_ENVIRONMENT_SUBAGENT_BYTES }
