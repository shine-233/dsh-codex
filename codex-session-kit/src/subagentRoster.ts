/**
 * DSH-native bounded subagent roster formatting.
 *
 * This module renders the durable direct-child listing that
 * `ctx.subagents.listChildren(parentSessionId, signal)` returns into a single
 * `<subagents>` envelope suitable for a request-time prompt context. It is a
 * pure function: it performs no discovery, reads no Session state, and holds
 * no authority of its own.
 *
 * Deliberate limits and failure semantics:
 *
 * - Item cap: at most {@link MAX_ROSTER_ROWS} child rows are emitted.
 * - Byte cap: the complete envelope — wrapper tags, indentation, line endings,
 *   escaped attributes, and rows included — is at most
 *   {@link MAX_ROSTER_BYTES} UTF-8 bytes.
 * - Ordering: the caller's authoritative order is preserved exactly.
 * - A child row that does not fit is skipped, and later rows are still
 *   considered.
 * - Diagnostics fail the whole call *before* truncation, so an incomplete
 *   listing is never silently presented as complete.
 * - Empty input, or input with no fitting row, yields `''`.
 *
 * @module codex-session-kit/subagentRoster
 */
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'

/** Maximum number of child rows in one roster envelope. */
export const MAX_ROSTER_ROWS = 8

/** Maximum UTF-8 size of the complete roster envelope, in bytes. */
export const MAX_ROSTER_BYTES = 1024

const OPEN = '<subagents>'
const CLOSE = '</subagents>'
const INDENT = '  '

/**
 * Escape a value for use inside a double-quoted XML attribute.
 * @param value - raw attribute text.
 * @returns the escaped text.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Render exactly one child entry as an `<agent />` line, without indentation.
 * @param entry - a `child` listing entry.
 * @returns the rendered line.
 */
function renderRow(entry: Extract<SubagentListEntry, { kind: 'child' }>): string {
  const parts = [`<agent id="${escapeAttribute(entry.id)}"`]
  parts.push(` mode="${entry.mode}"`)
  if (entry.label !== undefined && entry.label !== '') {
    parts.push(` label="${escapeAttribute(entry.label)}"`)
  }
  parts.push(' />')
  return parts.join('')
}

/**
 * Render a complete roster envelope from a direct-child listing.
 *
 * @param entries - the authoritative listing from `ctx.subagents.listChildren`.
 * @returns the bounded `<subagents>` envelope, or `''` when no row fits.
 * @throws {Error} when the listing contains any `diagnostic` entry. The error
 *   is raised before truncation, so a partial listing is never returned.
 */
export function formatSubagentRoster(
  entries: readonly SubagentListEntry[],
): string {
  // Pre-scan the complete listing: a diagnostic anywhere — including after the
  // eighth child candidate — must reject assembly rather than be truncated away.
  for (const entry of entries) {
    if (entry.kind === 'diagnostic') {
      throw new Error(
        `subagent listing contains a diagnostic entry for ${entry.id} (${entry.reason})`,
      )
    }
  }

  const children = entries.filter(
    (entry): entry is Extract<SubagentListEntry, { kind: 'child' }> =>
      entry.kind === 'child',
  )
  if (children.length === 0) return ''

  const rows: string[] = []
  let size = Buffer.byteLength(OPEN) + Buffer.byteLength(CLOSE)
  for (const child of children) {
    if (rows.length >= MAX_ROSTER_ROWS) break
    const line = INDENT + renderRow(child)
    const added = Buffer.byteLength('\n' + line)
    if (size + added > MAX_ROSTER_BYTES) continue
    rows.push(line)
    size += added
  }

  if (rows.length === 0) return ''
  return [OPEN, ...rows, CLOSE].join('\n')
}
