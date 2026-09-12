import { describe, expect, it, vi } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import {
  DurableCodexImportError,
  importCodexRolloutSession,
} from '../src/durableImport.js'

function rollout(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

const header = { type: 'session_meta', payload: { id: 'source-session' } }
const message = (text: unknown, role: unknown = 'user', blockType = 'input_text') => ({
  type: 'response_item',
  payload: { type: 'message', role, content: [{ type: blockType, text }] },
})

function persistence(options: { appendError?: Error; flushError?: Error; closeError?: Error } = {}) {
  const calls: string[] = []
  const handle = {
    append: vi.fn(async (_events: readonly any[]) => {
      calls.push('append')
      if (options.appendError) throw options.appendError
    }),
    flush: vi.fn(async () => {
      calls.push('flush')
      if (options.flushError) throw options.flushError
    }),
    close: vi.fn(async () => {
      calls.push('close')
      if (options.closeError) throw options.closeError
    }),
  }
  const create = vi.fn(async (_header: any) => {
    calls.push('create')
    return handle
  })
  return { ctx: { sessionPersistence: { create } } as any, create, handle, calls }
}

function expectPreflightFailure(source: string, code: string, line: number) {
  const target = persistence()
  return expect(importCodexRolloutSession(target.ctx, source)).rejects.toMatchObject({ code, line })
    .then(() => expect(target.create).not.toHaveBeenCalled())
}

describe('strict durable Codex rollout import', () => {
  it('maps plain user input_text blocks to deterministic balanced events', async () => {
    const target = persistence()
    const source = rollout(
      header,
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'first' },
            { type: 'input_text', text: ' second ' },
          ],
        },
      },
      message('third'),
    )

    const result = await importCodexRolloutSession(target.ctx, source)
    const persistedHeader = target.create.mock.calls[0][0]
    const events = target.handle.append.mock.calls[0][0]

    expect(result).toEqual({
      sessionId: persistedHeader.id,
      messageIds: [events[2].data.id, events[7].data.id],
      eventCount: 10,
    })
    expect(result.sessionId).toMatch(/^codex-import-v1-[0-9a-f]{64}$/)
    expect(result.messageIds).toEqual([
      expect.stringMatching(/^codex-import-message-v1-[0-9a-f]{64}$/),
      expect.stringMatching(/^codex-import-message-v1-[0-9a-f]{64}$/),
    ])
    expect(persistedHeader).toEqual({
      version: SESSION_FORMAT_VERSION, // 0.1.5 会话数据格式 V3
      id: result.sessionId,
      createdAt: expect.any(Number),
      isSeeded: false,
    })
    expect(Number.isSafeInteger(persistedHeader.createdAt)).toBe(true)
    expect(events.map((event: any) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(events.map((event: any) => event.type)).toEqual([
      'turn/start', 'step/start', 'user/message', 'step/end', 'turn/end',
      'turn/start', 'step/start', 'user/message', 'step/end', 'turn/end',
    ])
    expect(events[2]).toMatchObject({
      surfaceOp: 'append',
      data: {
        role: 'user',
        content: [{ type: 'text', text: 'first' }, { type: 'text', text: ' second ' }],
        source: { kind: 'user' },
      },
    })
    expect(events.filter((event: any) => event.type === 'session/end-seed')).toEqual([])
    expect(target.calls).toEqual(['create', 'append', 'flush', 'close'])
  })

  it('pins canonical identities across whitespace, line endings, and object key order', async () => {
    const a = persistence()
    const b = persistence()
    const sourceA = '{"type":"session_meta","payload":{"id":"x","extra":1}}\n' +
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}\n'
    const sourceB = '  { "payload" : { "extra" : 1, "id" : "x" }, "type" : "session_meta" }\r\n\r\n' +
      '{"payload":{"content":[{"text":"hello","type":"input_text"}],"role":"user","type":"message"},"type":"response_item"}\r\n'

    const first = await importCodexRolloutSession(a.ctx, sourceA)
    const second = await importCodexRolloutSession(b.ctx, sourceB)

    expect(first).toEqual(second)
    expect(first).toEqual({
      sessionId: 'codex-import-v1-cf601012d0265376261264924aaf16627192887f13df73ec053bc763417381b4',
      messageIds: ['codex-import-message-v1-4a4c8a827ee7d3e27fcbedf5376b98705055d47ddc0615bc536f50c1dc9b3846'],
      eventCount: 5,
    })
    expect(a.create.mock.calls[0][0].createdAt).toBe(b.create.mock.calls[0][0].createdAt)
  })

  it('changes identities when accepted content changes', async () => {
    const a = persistence()
    const b = persistence()
    const first = await importCodexRolloutSession(a.ctx, rollout(header, message('one')))
    const second = await importCodexRolloutSession(b.ctx, rollout(header, message('two')))
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.messageIds[0]).not.toBe(second.messageIds[0])
  })

  it('accepts session_header in first position', async () => {
    const target = persistence()
    await expect(importCodexRolloutSession(target.ctx, rollout({ type: 'session_header' }, message('ok'))))
      .resolves.toMatchObject({ eventCount: 5 })
  })

  it.each([
    ['malformed JSON', '{', 'MALFORMED_JSON', 1],
    ['primitive', '1', 'RECORD_NOT_OBJECT', 1],
    ['array', '[]', 'RECORD_NOT_OBJECT', 1],
    ['empty', '', 'MISSING_HEADER', 0],
    ['missing header', rollout(message('x')), 'MISSING_HEADER', 0],
    ['misplaced header', rollout(message('x'), header), 'HEADER_NOT_FIRST', 2],
    ['duplicate header', rollout(header, { type: 'session_header' }), 'DUPLICATE_HEADER', 2],
    ['unknown record', rollout(header, { type: 'unknown' }), 'UNEXPECTED_RECORD_TYPE', 2],
    ['payload primitive', rollout(header, { type: 'response_item', payload: 1 }), 'RESPONSE_PAYLOAD_NOT_OBJECT', 2],
    ['tool call item', rollout(header, { type: 'response_item', payload: { type: 'function_call' } }), 'UNSUPPORTED_RESPONSE_ITEM', 2],
    ['assistant message', rollout(header, message('x', 'assistant')), 'UNSUPPORTED_ROLE', 2],
    ['system message', rollout(header, message('x', 'system')), 'UNSUPPORTED_ROLE', 2],
    ['content primitive', rollout(header, { type: 'response_item', payload: { type: 'message', role: 'user', content: 1 } }), 'CONTENT_NOT_ARRAY', 2],
    ['primitive block', rollout(header, { type: 'response_item', payload: { type: 'message', role: 'user', content: [1] } }), 'CONTENT_BLOCK_NOT_OBJECT', 2],
    ['output_text', rollout(header, message('x', 'user', 'output_text')), 'UNSUPPORTED_CONTENT_BLOCK', 2],
    ['image', rollout(header, message('x', 'user', 'input_image')), 'UNSUPPORTED_CONTENT_BLOCK', 2],
    ['non-string text', rollout(header, message(1)), 'TEXT_NOT_STRING', 2],
    ['usage record', rollout(header, { type: 'event_msg', payload: { type: 'token_count' } }), 'UNEXPECTED_RECORD_TYPE', 2],
    ['reasoning record', rollout(header, { type: 'response_item', payload: { type: 'reasoning' } }), 'UNSUPPORTED_RESPONSE_ITEM', 2],
    ['compaction record', rollout(header, { type: 'compacted' }), 'UNEXPECTED_RECORD_TYPE', 2],
    ['realtime record', rollout(header, { type: 'realtime_event' }), 'UNEXPECTED_RECORD_TYPE', 2],
    ['shell record', rollout(header, { type: 'response_item', payload: { type: 'local_shell_call' } }), 'UNSUPPORTED_RESPONSE_ITEM', 2],
    ['search record', rollout(header, { type: 'response_item', payload: { type: 'web_search_call' } }), 'UNSUPPORTED_RESPONSE_ITEM', 2],
    ['unsupported trailing record', rollout(header, message('accepted'), { type: 'unknown' }), 'UNEXPECTED_RECORD_TYPE', 3],
  ])('rejects %s before create', async (_name, source, code, line) => {
    await expectPreflightFailure(source, code, line)
  })

  it('closes after append failure and skips flush', async () => {
    const failure = new Error('append failed')
    const target = persistence({ appendError: failure })
    await expect(importCodexRolloutSession(target.ctx, rollout(header, message('x')))).rejects.toBe(failure)
    expect(target.calls).toEqual(['create', 'append', 'close'])
  })

  it('closes after flush failure', async () => {
    const failure = new Error('flush failed')
    const target = persistence({ flushError: failure })
    await expect(importCodexRolloutSession(target.ctx, rollout(header, message('x')))).rejects.toBe(failure)
    expect(target.calls).toEqual(['create', 'append', 'flush', 'close'])
  })

  it('reports both operation and close failures', async () => {
    const appendError = new Error('append failed')
    const closeError = new Error('close failed')
    const target = persistence({ appendError, closeError })
    await expect(importCodexRolloutSession(target.ctx, rollout(header, message('x')))).rejects.toMatchObject({
      errors: [appendError, closeError],
    })
  })

  it('propagates create collisions without probing or changing existing bytes', async () => {
    const source = rollout(header, message('x'))
    const existingHeader = Buffer.from('{"existing":"header"}\n')
    const existingEvents = Buffer.from('{"existing":"events"}\n')
    const existingBytes = Buffer.concat([existingHeader, existingEvents])
    let storedBytes = Buffer.from(existingBytes)
    const collision = new Error('already exists')
    const create = vi.fn(async () => {
      throw collision
    })

    await expect(importCodexRolloutSession(
      { sessionPersistence: { create } } as any,
      source,
    )).rejects.toBe(collision)

    expect(create).toHaveBeenCalledTimes(1)
    expect(storedBytes).toEqual(existingBytes)
    expect(storedBytes.subarray(0, existingHeader.length)).toEqual(existingHeader)
    expect(storedBytes.subarray(existingHeader.length)).toEqual(existingEvents)
  })

  it('exposes line-aware typed errors', async () => {
    const target = persistence()
    const promise = importCodexRolloutSession(target.ctx, '\n' + rollout(header) + '\n{')
    await expect(promise).rejects.toBeInstanceOf(DurableCodexImportError)
    await expect(promise).rejects.toMatchObject({ code: 'MALFORMED_JSON', line: 3 })
  })
})
