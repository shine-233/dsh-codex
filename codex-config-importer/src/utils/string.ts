// Port of openai/codex utils/string (Apache-2.0, rust-v0.153.4):
// byte-boundary truncation helpers, metric tag sanitization, UUID finder,
// markdown anchor normalization. (Middle-truncation lives in policy-engine's
// outputTruncation port and is re-exported for parity.)

/** Take at most `maxb` UTF-8 bytes without splitting a code point. */
export function takeBytesAtCharBoundary(s: string, maxb: number): string {
  if (maxb <= 0) return ''
  const buf = Buffer.from(s, 'utf8')
  if (buf.length <= maxb) return s
  let end = maxb
  // walk back to a UTF-8 lead byte (continuation bytes are 0b10xxxxxx)
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}

/** Metric tag values allow only [A-Za-z0-9_:]; everything else becomes `_`. */
export function sanitizeMetricTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_:]/g, '_')
}

/** Find UUID v4-shaped substrings. */
export function findUuids(s: string): string[] {
  const re = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g
  return [...s.matchAll(re)].map((m) => m[0])
}

/** Normalize `#section-anchor` suffixes used in markdown file references. */
export function normalizeMarkdownHashLocationSuffix(suffix: string): string | null {
  const m = /^#(.+)$/.exec(suffix)
  if (!m) return null
  return m[1].trim().toLowerCase().replace(/\s+/g, '-') || null
}
