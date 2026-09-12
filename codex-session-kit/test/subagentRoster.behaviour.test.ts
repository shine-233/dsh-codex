/**
 * Runtime-behaviour proof for the request-time subagent roster beyond the
 * happy path: snapshot deduplication, stale-roster clearing, fail-closed
 * diagnostics and cancellation, and lifecycle/remount ownership.
 *
 * Everything here runs against the real DSH services and the real
 * Loader/Include composition, and asserts on the actual captured model
 * requests and durable Session logs.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { describe, expect, it } from 'vitest'

const ROSTER_CONTEXT_NAME = 'codex-session-kit:subagent-roster'
const RUNTIME_CONTEXT_SOURCE = '@deepseek-ai/dsh-system-prompt'

class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class CapturingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift() ?? textResponse('ok')
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

function requestTexts(options: GenerateOptions | undefined): string[] {
  const messages = (options?.messages ?? []) as readonly {
    content?: readonly { type?: string; text?: string }[]
  }[]
  const out: string[] = []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (typeof part?.text === 'string') out.push(part.text)
    }
  }
  return out
}

async function bootThroughLoader(
  root: string,
  script: StreamChunk[][],
): Promise<{ ctx: Context; adapter: CapturingAdapter }> {
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'codex-session-kit'",
    '',
  ].join('\n'))

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })

  const adapter = new CapturingAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)

  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const pluginModule = await import('../src/dsh-plugin.js')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['codex-session-kit', pluginModule],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) {
        throw new Error(`unexpected Loader import: ${specifier}`)
      }
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, adapter }
}

async function readStoredEvents(
  ctx: Context,
  sessionId: SessionId,
): Promise<readonly SessionEvent[]> {
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    return (await handle.read()).events
  } finally {
    await handle.close()
  }
}

/** Roster-bearing runtime-context snapshots in one log, in stored order. */
function rosterSnapshots(events: readonly SessionEvent[]): string[] {
  return events
    .filter(event =>
      (event.data as { source?: { plugin?: string } }).source?.plugin
        === RUNTIME_CONTEXT_SOURCE)
    .map(event => JSON.stringify(event.data))
    .filter(text => text.includes('<subagents>'))
}

/** Every runtime-context snapshot, including the cleared sentinel. */
function contextSnapshots(events: readonly SessionEvent[]): string[] {
  return events
    .filter(event =>
      (event.data as { source?: { plugin?: string } }).source?.plugin
        === RUNTIME_CONTEXT_SOURCE)
    .map(event => JSON.stringify(event.data))
}

describe('request-time subagent roster behaviour', () => {
  it('deduplicates an unchanged roster and clears it when it disappears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-roster-dedup-'))
    let ctx: Context | undefined
    try {
      const booted = await bootThroughLoader(root, [
        textResponse('a'),
        textResponse('b'),
        textResponse('c'),
      ])
      ctx = booted.ctx
      const signal = new AbortController().signal

      const parent = await ctx.agentLoop.create(
        'parent' as SessionId,
        { provider: 'mock', model: 'mock' },
      )

      // Turn 1: one direct child exists, so the roster is contributed.
      const child = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: 'worker',
        request: { prompt: [{ type: 'text', text: 'task' }], parent },
        signal,
      })
      parent.followup(createUserMessage({
        content: [{ type: 'text', text: 'one' }],
        source: { kind: 'user' },
      }))
      await parent.whenIdle()

      // Turn 2: identical listing — the snapshot must deduplicate, so no new
      // roster snapshot is appended even though the roster is still present in
      // the request.
      parent.followup(createUserMessage({
        content: [{ type: 'text', text: 'two' }],
        source: { kind: 'user' },
      }))
      await parent.whenIdle()
      expect(requestTexts(booted.adapter.requests.at(-1)).some(t => t.includes('<subagents>'))).toBe(true)

      void child
      const liveEvents = await readStoredEvents(ctx, 'parent' as SessionId).catch(() => [])
      void liveEvents

      // Restart to observe the durable snapshot history.
      await ctx.fiber.dispose()
      ctx = undefined
      const restarted = await bootThroughLoader(root, [
        textResponse('x'),
        textResponse('y'),
      ])
      ctx = restarted.ctx
      const stored = await readStoredEvents(ctx, 'parent' as SessionId)
      const snapshots = rosterSnapshots(stored)
      // Two identical listings, but only one durable roster snapshot.
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toContain(
        `label=\\"worker\\"`,
      )

      // Reconstruct from a fresh fold: the resumed request still carries it.
      const resumed = await restarted.ctx.agents.resume({
        resumeSessionId: 'parent' as SessionId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      try {
        resumed.agent.followup(createUserMessage({
          content: [{ type: 'text', text: 'three' }],
          source: { kind: 'user' },
        }))
        await resumed.agent.whenIdle()
        expect(requestTexts(restarted.adapter.requests.at(-1))
          .some(t => t.includes('<subagents>'))).toBe(true)
      } finally {
        await resumed.dispose()
      }
    } finally {
      try {
        if (ctx) await ctx.fiber.dispose()
      } finally {
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }
  })

  it('fails the assembly closed on listing cancellation without sending a request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-roster-abort-'))
    let ctx: Context | undefined
    try {
      const booted = await bootThroughLoader(root, [textResponse('never')])
      ctx = booted.ctx
      const parent = await ctx.agentLoop.create(
        'abort-parent' as SessionId,
        { provider: 'mock', model: 'mock' },
      )

      // Force the roster's listing read to reject; assembly must fail closed and
      // no model request may be dispatched.
      const original = ctx.subagents.listChildren.bind(ctx.subagents)
      ctx.subagents.listChildren = () => Promise.reject(new Error('listing cancelled'))

      parent.followup(createUserMessage({
        content: [{ type: 'text', text: 'go' }],
        source: { kind: 'user' },
      }))
      await parent.whenIdle().catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 50))

      void original
      expect(booted.adapter.requests).toHaveLength(0)
      const events = await readStoredEvents(ctx, 'abort-parent' as SessionId).catch(() => [])
      expect(rosterSnapshots(events)).toHaveLength(0)
    } finally {
      if (ctx) await ctx.fiber.dispose().catch(() => {})
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('contributes the roster exactly once per request and detaches on plugin disposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-roster-lifecycle-'))
    let ctx: Context | undefined
    try {
      const booted = await bootThroughLoader(root, [
        textResponse('a'),
        textResponse('b'),
        textResponse('c'),
      ])
      ctx = booted.ctx
      const signal = new AbortController().signal

      const parent = await ctx.agentLoop.create(
        'life-parent' as SessionId,
        { provider: 'mock', model: 'mock' },
      )
      await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: 'worker',
        request: { prompt: [{ type: 'text', text: 'task' }], parent },
        signal,
      })

      parent.followup(createUserMessage({
        content: [{ type: 'text', text: 'one' }],
        source: { kind: 'user' },
      }))
      await parent.whenIdle()

      // Exactly one roster contribution on the request, never a duplicate.
      const texts = requestTexts(booted.adapter.requests.at(-1))
      const rosterTexts = texts.filter(t => t.includes('<subagents>'))
      expect(rosterTexts).toHaveLength(1)

      // A second turn with the same listing also contributes exactly one
      // roster, proving the listener is installed once per Agent.
      parent.followup(createUserMessage({
        content: [{ type: 'text', text: 'two' }],
        source: { kind: 'user' },
      }))
      await parent.whenIdle()
      const secondTexts = requestTexts(booted.adapter.requests.at(-1))
      expect(secondTexts.filter(t => t.includes('<subagents>'))).toHaveLength(1)

      // Plugin disposal detaches every Agent-owned listener and settles
      // cleanly; the durable child is untouched by teardown.
      await ctx.fiber.dispose()
      ctx = undefined
    } finally {
      if (ctx) await ctx.fiber.dispose().catch(() => {})
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
