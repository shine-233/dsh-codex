// dsh plugin entry for codex-session-kit (from openai/codex rollout formats, Apache-2.0)
// Tools: import/inspect codex session rollouts; append-only key/value memory.
// Request-time: durable direct-subagent roster as a named prompt context.
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { listSessions, parseRolloutFile, toDshEvents, MemoryStore } from './index.js';
import { formatSubagentRoster, MAX_ROSTER_BYTES, MAX_ROSTER_ROWS } from './subagentRoster.js';
import { AgentGraphStore, MAX_ENVIRONMENT_SUBAGENTS, MAX_ENVIRONMENT_SUBAGENT_BYTES } from './agentGraph.js';

export const name = 'codex-session-kit'
// `tools` is the only hard requirement: the session tools must register in any
// harness that mounts tools. The roster below is an optional contribution gated
// on the additional services it needs.
export const inject = ['tools']

/** The named prompt context this plugin contributes at request time. */
export const ROSTER_CONTEXT_NAME = 'codex-session-kit:subagent-roster'

type UnknownRecord = Record<string, unknown>

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as UnknownRecord : {}
}

/**
 * Install one Agent-scoped request-time roster listener on an Agent's own
 * context, gated on the optional services it actually needs.
 *
 * `systemPrompt` and `subagents` are optional for the plugin as a whole — the
 * session tools must still register in a harness that mounts only `tools` — so
 * the roster is installed through the Agent's own `inject`, exactly like other
 * DSH plugins gate an optional request-time contribution. The
 * `system-prompt/assemble` waterfall is scope-filtered, so the listener opts
 * into `global` dispatch; its own scope is checked implicitly by the Agent it
 * was installed for.
 *
 * @param ctx - the plugin context.
 * @param agent - the Agent whose assemblies this listener observes.
 * @returns a disposer that detaches this listener's gated fiber.
 */
function installRosterListener(ctx: Context, agent: Agent): () => void {
  // `global: true` is required: `system-prompt/assemble` is scope-filtered, and
  // an Agent-scoped assembly is dispatched with the Agent as its scope key, so
  // a listener registered on this child scope would otherwise never be reached.
  const fiber = agent.ctx.inject(['systemPrompt', 'subagents'], (scope) => {
    scope.on('system-prompt/assemble', async (
      _assembly: PromptAssembly,
      context: AssembleContext,
      next: () => Promise<PromptAssembly>,
    ): Promise<PromptAssembly> => {
      const assembled = await next()
      // Use the injected scope: it is guaranteed to carry the `subagents`
      // service this optional contribution depends on.
      const entries = await scope.subagents.listChildren(agent.session.id, context.signal)
      const text = formatSubagentRoster(entries)
      if (text === '') return assembled
      if (assembled.contexts.some(item => item.name === ROSTER_CONTEXT_NAME)) {
        throw new Error(`duplicate subagent roster prompt context: ${ROSTER_CONTEXT_NAME}`)
      }
      return {
        ...assembled,
        contexts: [...assembled.contexts, { name: ROSTER_CONTEXT_NAME, text }],
      }
    }, { global: true })
  })
  // `inject()` returns a Fiber; disposing it detaches the gated listener.
  return () => { void fiber.dispose() }
}

export function apply(ctx: Context, config: unknown = {}) {
  const cfg = asRecord(config)
  const memoryPath = typeof cfg.memoryPath === 'string' && cfg.memoryPath
    ? cfg.memoryPath
    : join(homedir(), '.dsh', 'codex-memory.jsonl')
  let memory: MemoryStore | null
  try { memory = new MemoryStore(memoryPath) } catch { memory = null }

  // 1. Own every tool registration explicitly so plugin disposal is exact.
  ctx.effect(() => {
    const disposers: (() => void)[] = []

    disposers.push(ctx.tools.register(defineTool({
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
    })))

    disposers.push(ctx.tools.register(defineTool({
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
    })))

    return () => { for (const dispose of disposers) dispose() }
  }, 'codex-session-kit:tools')

  // 2. Own one roster listener per live Agent, plus every future Agent. The
  //    roster is an optional contribution: the session tools above must still
  //    register in a harness that mounts only `tools`, so the whole roster
  //    concern is gated on the services it additionally needs.
  ctx.inject(['agents'], (agentScope) => {
    agentScope.effect(() => {
      const listeners = new Map<Agent, () => void>()
      const install = (agent: Agent): void => {
        if (listeners.has(agent)) return
        listeners.set(agent, installRosterListener(ctx, agent))
      }
      const remove = (agent: Agent): void => {
        const dispose = listeners.get(agent)
        if (dispose === undefined) return
        listeners.delete(agent)
        dispose()
      }

      for (const agent of agentScope.agents.list()) install(agent)
      const stopCreated = agentScope.on('agent/created', ({ agent }) => { install(agent) })
      const stopDisposed = agentScope.on('agent/disposed', ({ agent }) => { remove(agent) })

      return () => {
        stopCreated()
        stopDisposed()
        for (const dispose of listeners.values()) dispose()
        listeners.clear()
      }
    }, 'codex-session-kit:roster')
  })
}

export * from './index.js'
export { formatSubagentRoster, MAX_ROSTER_BYTES, MAX_ROSTER_ROWS }
export { AgentGraphStore, MAX_ENVIRONMENT_SUBAGENTS, MAX_ENVIRONMENT_SUBAGENT_BYTES }
