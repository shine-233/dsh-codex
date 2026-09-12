import { createHash } from 'node:crypto'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** Minimal persistence capability required by the strict rollout importer. */
export interface DurableCodexImportContext {
  readonly sessionPersistence: Pick<SessionPersistence, 'create'>
}

/** Stable identities and event count created by one accepted rollout. */
export interface DurableCodexImportResult {
  readonly sessionId: SessionId
  readonly messageIds: readonly MessageId[]
  readonly eventCount: number
}

/** Stable validation code for one rejected rollout record. */
export type DurableCodexImportErrorCode =
  | 'MALFORMED_JSON'
  | 'RECORD_NOT_OBJECT'
  | 'MISSING_HEADER'
  | 'HEADER_NOT_FIRST'
  | 'DUPLICATE_HEADER'
  | 'UNEXPECTED_RECORD_TYPE'
  | 'RESPONSE_PAYLOAD_NOT_OBJECT'
  | 'UNSUPPORTED_RESPONSE_ITEM'
  | 'UNSUPPORTED_ROLE'
  | 'CONTENT_NOT_ARRAY'
  | 'CONTENT_BLOCK_NOT_OBJECT'
  | 'UNSUPPORTED_CONTENT_BLOCK'
  | 'TEXT_NOT_STRING'

/** Line-aware failure produced before persistence begins. */
export class DurableCodexImportError extends Error {
  readonly name = 'DurableCodexImportError'

  /**
   * Construct one strict rollout rejection.
   * @param code - stable machine-readable category.
   * @param line - one-based nonblank source line, or zero for whole-document failures.
   * @param detail - concise failure detail.
   */
  constructor(
    readonly code: DurableCodexImportErrorCode,
    readonly line: number,
    detail: string,
  ) {
    super(`${code} at line ${line}: ${detail}`)
  }
}

interface ParsedRecord {
  readonly line: number
  readonly value: Record<string, unknown>
}

interface AcceptedMessage {
  readonly record: Record<string, unknown>
  readonly blocks: readonly string[]
}

const SESSION_DOMAIN = 'codex-session-kit/session/v1\0'
const MESSAGE_DOMAIN = 'codex-session-kit/message/v1\0'
const TIME_DOMAIN = 'codex-session-kit/time/v1\0'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
  return `{${entries.join(',')}}`
}

function digest(domain: string, value: string): string {
  return createHash('sha256').update(domain).update(value).digest('hex')
}

function parseRecords(sourceText: string): ParsedRecord[] {
  const records: ParsedRecord[] = []
  for (const [index, sourceLine] of sourceText.split(/\r?\n/u).entries()) {
    if (!sourceLine.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(sourceLine)
    } catch {
      throw new DurableCodexImportError('MALFORMED_JSON', index + 1, 'invalid JSON')
    }
    if (!isRecord(value)) {
      throw new DurableCodexImportError('RECORD_NOT_OBJECT', index + 1, 'record must be a JSON object')
    }
    records.push({ line: index + 1, value })
  }
  return records
}

function isHeader(value: Record<string, unknown>): boolean {
  return value.type === 'session_meta' || value.type === 'session_header'
}

function validateHeader(records: readonly ParsedRecord[]): void {
  if (records.length === 0) {
    throw new DurableCodexImportError('MISSING_HEADER', 0, 'rollout has no records')
  }
  const firstHeader = records.findIndex(({ value }) => isHeader(value))
  if (firstHeader < 0) {
    throw new DurableCodexImportError('MISSING_HEADER', 0, 'rollout has no session header')
  }
  if (firstHeader !== 0) {
    throw new DurableCodexImportError('HEADER_NOT_FIRST', records[firstHeader].line, 'session header must be the first record')
  }
  const duplicate = records.slice(1).find(({ value }) => isHeader(value))
  if (duplicate) {
    throw new DurableCodexImportError('DUPLICATE_HEADER', duplicate.line, 'rollout contains more than one session header')
  }
}

function validateMessage({ line, value }: ParsedRecord): AcceptedMessage {
  if (value.type !== 'response_item') {
    throw new DurableCodexImportError('UNEXPECTED_RECORD_TYPE', line, `unsupported record type ${String(value.type)}`)
  }
  if (!isRecord(value.payload)) {
    throw new DurableCodexImportError('RESPONSE_PAYLOAD_NOT_OBJECT', line, 'response_item payload must be an object')
  }
  const payload = value.payload
  if (payload.type !== 'message') {
    throw new DurableCodexImportError('UNSUPPORTED_RESPONSE_ITEM', line, `unsupported response item ${String(payload.type)}`)
  }
  if (payload.role !== 'user') {
    throw new DurableCodexImportError('UNSUPPORTED_ROLE', line, `unsupported message role ${String(payload.role)}`)
  }
  if (!Array.isArray(payload.content)) {
    throw new DurableCodexImportError('CONTENT_NOT_ARRAY', line, 'message content must be an array')
  }
  const blocks = payload.content.map((block) => {
    if (!isRecord(block)) {
      throw new DurableCodexImportError('CONTENT_BLOCK_NOT_OBJECT', line, 'content block must be an object')
    }
    if (block.type !== 'input_text') {
      throw new DurableCodexImportError('UNSUPPORTED_CONTENT_BLOCK', line, `unsupported content block ${String(block.type)}`)
    }
    if (typeof block.text !== 'string') {
      throw new DurableCodexImportError('TEXT_NOT_STRING', line, 'input_text text must be a string')
    }
    return block.text
  })
  return { record: value, blocks }
}

function deriveTime(sessionDigest: string, messageCount: number): number {
  const bytes = createHash('sha256').update(TIME_DOMAIN).update(sessionDigest).digest()
  const base = Number(bytes.readBigUInt64BE(0) & ((1n << 52n) - 1n))
  const maxOffset = Math.max(0, messageCount * 5 - 1)
  return Math.min(base, Number.MAX_SAFE_INTEGER - maxOffset)
}

function prepareImport(sourceText: string): {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly messageIds: readonly MessageId[]
} {
  const records = parseRecords(sourceText)
  validateHeader(records)
  const messages = records.slice(1).map(validateMessage)
  const canonicalRollout = canonicalize(records.map(({ value }) => value))
  const sessionDigest = digest(SESSION_DOMAIN, canonicalRollout)
  const sessionId = SessionId(`codex-import-v1-${sessionDigest}`)
  const createdAt = deriveTime(sessionDigest, messages.length)
  const messageIds: MessageId[] = []
  const events: SessionEvent[] = []

  for (const [index, message] of messages.entries()) {
    const turn = index + 1
    const offset = index * 5
    const messageDigest = digest(
      MESSAGE_DOMAIN,
      `${sessionDigest}\0${index}\0${canonicalize(message.record)}`,
    )
    const messageId = MessageId(`codex-import-message-v1-${messageDigest}`)
    messageIds.push(messageId)
    events.push(
      { type: 'turn/start', seq: SessionSeq(offset), time: createdAt + offset, data: { turn } },
      { type: 'step/start', seq: SessionSeq(offset + 1), time: createdAt + offset + 1, data: { turn, step: 1 } },
      {
        type: 'user/message',
        seq: SessionSeq(offset + 2),
        time: createdAt + offset + 2,
        data: freezeMessage({
          id: messageId,
          role: 'user',
          content: message.blocks.map((text) => ({ type: 'text' as const, text })),
          source: { kind: 'user' as const },
        }),
        surfaceOp: 'append',
      },
      { type: 'step/end', seq: SessionSeq(offset + 3), time: createdAt + offset + 3, data: { turn, step: 1 } },
      { type: 'turn/end', seq: SessionSeq(offset + 4), time: createdAt + offset + 4, data: { turn, reason: { kind: 'completed' } } },
    )
  }

  return {
    header: Object.freeze({ version: SESSION_FORMAT_VERSION, id: sessionId, createdAt, isSeeded: false }),
    events,
    messageIds,
  }
}

/**
 * Strictly import the accepted user-text subset of one Codex rollout.
 *
 * The complete source is parsed, validated, canonicalized, and mapped before
 * `create` runs. After creation, the generic persistence API has no rollback;
 * this function guarantees one append, an explicit durability flush, and handle
 * closure, but cannot promise artifact removal after backend I/O fails.
 *
 * @param ctx - persistence creation capability owned by the caller.
 * @param sourceText - immutable rollout JSONL text read by the caller.
 * @returns deterministic Session and Message identities plus the event count.
 */
export async function importCodexRolloutSession(
  ctx: DurableCodexImportContext,
  sourceText: string,
): Promise<DurableCodexImportResult> {
  const prepared = prepareImport(sourceText)
  const handle = await ctx.sessionPersistence.create(prepared.header)
  let operationError: unknown
  try {
    await handle.append(prepared.events)
    await handle.flush()
  } catch (error: unknown) {
    operationError = error
  }

  let closeError: unknown
  try {
    await handle.close()
  } catch (error: unknown) {
    closeError = error
  }

  if (operationError !== undefined && closeError !== undefined) {
    throw new AggregateError([operationError, closeError], 'Codex rollout persistence and handle closure both failed')
  }
  if (operationError !== undefined) throw operationError
  if (closeError !== undefined) throw closeError

  return {
    sessionId: prepared.header.id,
    messageIds: prepared.messageIds,
    eventCount: prepared.events.length,
  }
}
