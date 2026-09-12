import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, {
  type SessionEvent,
  type SessionId,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionAlreadyExistsError } from '@deepseek-ai/dsh-session-persistence'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  importCodexRolloutSession,
  type DurableCodexImportContext,
} from '../src/durableImport.js'

const SOURCE =
  '{"type":"session_meta","payload":{"id":"x","extra":1}}\n' +
  '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}\n'

const IMPORTED_SESSION_ID =
  'codex-import-v1-cf601012d0265376261264924aaf16627192887f13df73ec053bc763417381b4'

const IMPORTED_MESSAGE_ID =
  'codex-import-message-v1-4a4c8a827ee7d3e27fcbedf5376b98705055d47ddc0615bc536f50c1dc9b3846'

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({
      type: 'text-delta',
      index: 0,
      text: char,
    })),
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
    const entry = this.script.shift()
    if (!entry) throw new Error('CapturingAdapter: script exhausted')
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

async function mountPersistentHarness(
  root: string,
  adapter?: CapturingAdapter,
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  if (adapter) ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

type CreateSession = DurableCodexImportContext['sessionPersistence']['create']

async function importThroughCreate(create: CreateSession, sourceText: string) {
  return importCodexRolloutSession({ sessionPersistence: { create } }, sourceText)
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

async function readStoredBytes(ctx: Context, sessionId: SessionId): Promise<Buffer> {
  const persistence = ctx.sessionPersistence as typeof ctx.sessionPersistence & {
    resolveCurrentLog(id: SessionId, signal?: AbortSignal): Promise<string | undefined>
  }
  const path = await persistence.resolveCurrentLog(sessionId)
  if (path === undefined) throw new Error(`missing JSONL artifact for ${sessionId}`)
  return readFile(path)
}

function instrumentCreate(ctx: Context): {
  readonly create: CreateSession
  readonly calls: string[]
} {
  const calls: string[] = []
  const realCreate = ctx.sessionPersistence.create.bind(ctx.sessionPersistence)
  const create: CreateSession = async (...args) => {
    calls.push('create')
    const handle = await realCreate(...args)
    const realAppend = handle.append.bind(handle)
    const realFlush = handle.flush.bind(handle)
    const realClose = handle.close.bind(handle)
    handle.append = async (...appendArgs) => {
      calls.push('append')
      return realAppend(...appendArgs)
    }
    handle.flush = async (...flushArgs) => {
      calls.push('flush')
      return realFlush(...flushArgs)
    }
    handle.close = async () => {
      calls.push('close')
      return realClose()
    }
    return handle
  }
  return { create, calls }
}

describe('durable Codex import and real AgentLoop resume', () => {
  it('restores imported history and consumes it in the next model request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-session-kit-resume-'))
    let ctx1: Context | undefined
    let ctx2: Context | undefined

    try {
      ctx1 = await mountPersistentHarness(root)
      const observed = instrumentCreate(ctx1)
      const imported = await importThroughCreate(observed.create, SOURCE)

      expect(imported).toEqual({
        sessionId: IMPORTED_SESSION_ID,
        messageIds: [IMPORTED_MESSAGE_ID],
        eventCount: 5,
      })
      expect(observed.calls).toEqual(['create', 'append', 'flush', 'close'])

      await ctx1.fiber.dispose()
      ctx1 = undefined

      const adapter = new CapturingAdapter([textResponse('continued response')])
      ctx2 = await mountPersistentHarness(root, adapter)

      const beforeResume = await readStoredEvents(ctx2, imported.sessionId)
      expect(beforeResume).toHaveLength(5)
      expect(beforeResume.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
      expect(beforeResume.some((event) => event.type === 'session/end-seed')).toBe(false)

      const existingBytes = await readStoredBytes(ctx2, imported.sessionId)
      await expect(importThroughCreate(
        ctx2.sessionPersistence.create.bind(ctx2.sessionPersistence),
        SOURCE,
      )).rejects.toBeInstanceOf(SessionAlreadyExistsError)
      expect(await readStoredBytes(ctx2, imported.sessionId)).toEqual(existingBytes)

      const resumed = await ctx2.agents.resume({
        resumeSessionId: imported.sessionId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })

      try {
        resumed.agent.followup(createUserMessage({
          content: [{ type: 'text', text: 'continue' }],
          source: { kind: 'user' },
        }))
        await resumed.agent.whenIdle()

        expect(adapter.requests).toHaveLength(1)
        expect(adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'mock' })
        expect(adapter.requests[0]?.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: IMPORTED_MESSAGE_ID,
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          }),
        ]))
      } finally {
        await resumed.dispose()
      }

      const events = await readStoredEvents(ctx2, imported.sessionId)
      expect(events.map((event) => event.seq)).toEqual(
        events.map((_, index) => index),
      )
      expect(events[5]?.type).toBe('session/end-seed')
      expect(events.some((event) =>
        event.type === 'turn/end' && event.data.reason.kind === 'interrupted')).toBe(false)
    } finally {
      try {
        if (ctx2) await ctx2.fiber.dispose()
      } finally {
        try {
          if (ctx1) await ctx1.fiber.dispose()
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    }
  })
})
