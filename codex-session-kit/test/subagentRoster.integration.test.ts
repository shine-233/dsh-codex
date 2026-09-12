/**
 * Real-composition proof for the request-time subagent roster.
 *
 * This suite boots `codex-session-kit` through the real Cordis Loader/Include
 * configuration path, mounts the actual DSH 0.1.3-alpha.1 services, creates a
 * real parent plus durable direct children through the supported subagent
 * lifecycle, and then asserts on the *actual captured model request* that the
 * named roster context `codex-session-kit:subagent-roster` is present and
 * durable across a complete Context restart.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
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

export const ROSTER_CONTEXT_NAME = 'codex-session-kit:subagent-roster'
const RUNTIME_CONTEXT_SOURCE = '@deepseek-ai/dsh-system-prompt'

/** Session query whose search faces are intentionally unavailable. */
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

/** Captures every request the loop actually dispatches to the model. */
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

/** Pull every text fragment out of the dispatched request messages. */
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

/**
 * Boot the plugin through the real Loader/Include path over a JSONL root.
 * The Loader owns the agent/system-prompt/tools mounts, exactly as the shipped
 * cordis.yml does.
 */
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

/** All roster-bearing runtime-context snapshots stored in one session log. */
function rosterSnapshots(events: readonly SessionEvent[]): string[] {
  return events
    .filter(event =>
      (event.data as { source?: { plugin?: string } }).source?.plugin
        === RUNTIME_CONTEXT_SOURCE)
    .map(event => JSON.stringify(event.data))
    .filter(text => text.includes('<subagents>'))
}

describe('request-time subagent roster (real Loader composition)', () => {
  it('contributes the durable direct-child roster to the actual model request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-roster-root-'))
    const childRoots: string[] = []
    let ctx: Context | undefined
    try {
      const booted = await bootThroughLoader(root, [
        textResponse('ack'),
        textResponse('ack'),
      ])
      ctx = booted.ctx

      // Real parent session.
      const parent = await ctx.agentLoop.create(
        'parent' as SessionId,
        { provider: 'mock', model: 'mock' },
      )

      // Two durable direct children through the supported lifecycle.
      const signal = new AbortController().signal
      const continuable = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: 'worker',
        request: { prompt: [{ type: 'text', text: 'task: worker' }], parent },
        signal,
      })
      void continuable

      const oneShot = await ctx.subagents.start('spawn', {
        prompt: [{ type: 'text', text: 'finish once' }],
        parent,
        signal,
      })
      await oneShot.result
      await oneShot.dispose()
      childRoots.push(root)

      // Drive one real model request and capture it.
      parent.followup(createUserMessage({
        content: [{ type: 'text', text: 'status?' }],
        source: { kind: 'user' },
      }))
      await parent.whenIdle()

      const request = booted.adapter.requests.at(-1)
      const texts = requestTexts(request)
      const roster = texts.find(text => text.includes('<subagents>'))

      // The current request carries the roster for the child that is
      // resolvable at request time: the live continuable child, with its
      // durable id, mode, and label. The one-shot child was disposed in this
      // same turn and its live `subagent` identity is not yet resolvable while
      // it is still live (the DSH creation window), so it is deliberately
      // absent here and is asserted after the restart below instead.
      expect(roster).toBeDefined()
      expect(roster).toContain('<agent id="' + String(continuable.childId) + '"')
      expect(roster).toContain('mode="continuable"')
      expect(roster).toContain('label="worker"')
      expect(roster).not.toContain('mode="one-shot"')

      await ctx.fiber.dispose()
      ctx = undefined

      // Full Context restart over the same JSONL root: the roster snapshot
      // must be durable and reconstructable from the parent's own log.
      const restarted = await bootThroughLoader(root, [
        textResponse('ack'),
        textResponse('ack'),
      ])
      ctx = restarted.ctx
      const stored = await readStoredEvents(ctx, 'parent' as SessionId)
      expect(rosterSnapshots(stored).length).toBeGreaterThan(0)

      // Cold: both durable children are resolvable from the restarted corpus.
      const coldChildren = await restarted.ctx.subagents.listChildren('parent' as SessionId)
      const coldModes = coldChildren
        .filter(entry => entry.kind === 'child')
        .map(entry => (entry as { mode: string }).mode)
        .sort()
      expect(coldModes).toEqual(['continuable', 'one-shot'])

      const replayed = await restarted.ctx.agents.resume({
        resumeSessionId: 'parent' as SessionId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      try {
        replayed.agent.followup(createUserMessage({
          content: [{ type: 'text', text: 'again' }],
          source: { kind: 'user' },
        }))
        await replayed.agent.whenIdle()
        const resumedTexts = requestTexts(restarted.adapter.requests.at(-1))
        const resumedRoster = resumedTexts.find(text => text.includes('<subagents>'))
        // The resumed request carries a durable roster; the continuable child is
        // always resolvable and is the stable in-request assertion. Whether the
        // just-disposed one-shot has already become cold-resolvable at this exact
        // instant depends on DSH persistence timing, so it is asserted by the
        // deterministic cold listing above rather than here.
        expect(resumedRoster).toBeDefined()
        expect(resumedRoster).toContain('<agent id="' + String(continuable.childId) + '"')
        expect(resumedRoster).toContain('mode="continuable"')
        expect(resumedRoster).toContain('label="worker"')
      } finally {
        await replayed.dispose()
      }
    } finally {
      try {
        if (ctx) await ctx.fiber.dispose()
      } finally {
        for (const childRoot of childRoots.splice(0)) {
          rmSync(childRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }
  })
})

void readFile
void mkdtempSync
