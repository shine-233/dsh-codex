import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import {
  MAX_ROSTER_BYTES,
  MAX_ROSTER_ROWS,
  formatSubagentRoster,
} from '../src/subagentRoster.js'

function child(
  id: string,
  mode: 'one-shot' | 'continuable',
  label?: string,
): SubagentListEntry {
  return mode === 'one-shot'
    ? { kind: 'child', id: id as SessionId, activity: 'inactive', hasChildren: false, mode, ...(label === undefined ? {} : { label }) }
    : { kind: 'child', id: id as SessionId, activity: 'inactive', hasChildren: false, mode, label: label ?? '' }
}

function diagnostic(id: string, reason: 'corrupt' | 'unsupported' | 'unavailable'): SubagentListEntry {
  return { kind: 'diagnostic', id: id as SessionId, reason }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

describe('formatSubagentRoster', () => {
  it('returns empty text for an empty listing', () => {
    expect(formatSubagentRoster([])).toBe('')
  })

  it('renders a one-shot child without a label', () => {
    const out = formatSubagentRoster([child('s1', 'one-shot')])
    expect(out).toBe('<subagents>\n  <agent id="s1" mode="one-shot" />\n</subagents>')
  })

  it('renders a one-shot child with a label', () => {
    const out = formatSubagentRoster([child('s1', 'one-shot', 'worker')])
    expect(out).toContain('<agent id="s1" mode="one-shot" label="worker" />')
  })

  it('renders a continuable child with its required label', () => {
    const out = formatSubagentRoster([child('s2', 'continuable', 'scout')])
    expect(out).toContain('<agent id="s2" mode="continuable" label="scout" />')
  })

  it('allows duplicate label values on separate rows', () => {
    const out = formatSubagentRoster([
      child('a', 'continuable', 'same'),
      child('b', 'continuable', 'same'),
    ])
    expect(out.match(/label="same"/g)).toHaveLength(2)
  })

  it('escapes arbitrary XML attribute characters', () => {
    const out = formatSubagentRoster([child('id<&">', 'one-shot', 'a & b <c> "d"')])
    expect(out).toContain('id="id&lt;&amp;&quot;&gt;"')
    expect(out).toContain('label="a &amp; b &lt;c&gt; &quot;d&quot;"')
    expect(out).not.toContain('label="a & b')
  })

  it('counts multibyte UTF-8 bytes rather than code units', () => {
    // Each CJK char is 3 UTF-8 bytes but 1 code unit.
    const out = formatSubagentRoster([child('s1', 'continuable', '工作员')])
    expect(byteLength(out)).toBeGreaterThan(out.length)
    expect(out).toContain('工作员')
  })

  it('preserves the caller authoritative order', () => {
    const out = formatSubagentRoster([
      child('z', 'one-shot'),
      child('a', 'one-shot'),
      child('m', 'one-shot'),
    ])
    expect(out.indexOf('id="z"')).toBeLessThan(out.indexOf('id="a"'))
    expect(out.indexOf('id="a"')).toBeLessThan(out.indexOf('id="m"'))
  })

  it('emits at most eight rows', () => {
    const entries = Array.from({ length: 12 }, (_, i) => child(`s${i}`, 'one-shot'))
    const out = formatSubagentRoster(entries)
    expect(out.match(/<agent /g)).toHaveLength(MAX_ROSTER_ROWS)
    expect(out).not.toContain('id="s9"')
  })

  it('fits an envelope exactly at the byte cap and overflows by one', () => {
    // Find a label length where the envelope lands exactly on the cap.
    let exact = ''
    for (let pad = 0; pad < 2000; pad += 1) {
      const candidate = formatSubagentRoster([
        child('s1', 'continuable', 'x'.repeat(pad)),
      ])
      if (byteLength(candidate) === MAX_ROSTER_BYTES) {
        exact = candidate
        break
      }
    }
    expect(exact).not.toBe('')
    expect(byteLength(exact)).toBe(MAX_ROSTER_BYTES)

    // One more label character must no longer fit, dropping the row entirely.
    const over = formatSubagentRoster([
      child('s1', 'continuable', 'x'.repeat(2001)),
    ])
    expect(over).toBe('')
  })

  it('skips an oversized row and still considers later rows', () => {
    const huge = child('huge', 'continuable', 'x'.repeat(4000))
    const out = formatSubagentRoster([huge, child('small', 'one-shot')])
    expect(out).not.toContain('huge')
    expect(out).toContain('id="small"')
  })

  it('skips a mid-list oversized row without breaking the envelope', () => {
    const out = formatSubagentRoster([
      child('a', 'one-shot'),
      child('huge', 'continuable', 'x'.repeat(4000)),
      child('b', 'one-shot'),
    ])
    expect(out).toContain('id="a"')
    expect(out).toContain('id="b"')
    expect(out).not.toContain('huge')
    expect(byteLength(out)).toBeLessThanOrEqual(MAX_ROSTER_BYTES)
  })

  it('throws when a diagnostic precedes the truncation point', () => {
    expect(() => formatSubagentRoster([
      diagnostic('bad', 'corrupt'),
      child('ok', 'one-shot'),
    ])).toThrow(/diagnostic/)
  })

  it('throws for a diagnostic that appears after the eighth child candidate', () => {
    const children = Array.from({ length: 10 }, (_, i) => child(`s${i}`, 'one-shot'))
    expect(() => formatSubagentRoster([
      ...children,
      diagnostic('late', 'unavailable'),
    ])).toThrow(/late/)
  })

  it('returns empty text when no row fits', () => {
    expect(formatSubagentRoster([
      child('a', 'continuable', 'x'.repeat(4000)),
    ])).toBe('')
  })

  it('renders nothing extra for an all-diagnostic-free but empty child set', () => {
    expect(formatSubagentRoster([])).toBe('')
  })
})
