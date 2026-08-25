// Port of openai/codex codex-rs/apply-patch/src/seek_sequence.rs (Apache-2.0)
// Four progressively looser passes: exact -> rstrip -> trim -> Unicode-normalized.
// Upstream anchor: see NOTICE.md.

export type UpdateFileMode = 'NormalizeToLf' | 'PreserveLineEndings';

const DASHES = ['\u2010','\u2011','\u2012','\u2013','\u2014','\u2015','\u2212'];
const SINGLE_QUOTES = ['\u2018','\u2019','\u201A','\u201B'];
const DOUBLE_QUOTES = ['\u201C','\u201D','\u201E','\u201F'];
const ODD_SPACES = ['\u00A0','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007','\u2008','\u2009','\u200A','\u202F','\u205F','\u3000'];

function normalise(s: string): string {
  return Array.from(s.trim())
    .map((c) => {
      if (DASHES.includes(c)) return '-';
      if (SINGLE_QUOTES.includes(c)) return "'";
      if (DOUBLE_QUOTES.includes(c)) return '"';
      if (ODD_SPACES.includes(c)) return ' ';
      return c;
    })
    .join('');
}

/**
 * Attempt to find `pattern` within `lines` starting at or after `start`.
 * Returns the starting index of the match or null. Matches are attempted with
 * decreasing strictness: exact, ignoring trailing whitespace, ignoring leading
 * and trailing whitespace, and finally after normalizing common Unicode
 * punctuation to ASCII equivalents. When `eof` is true we first try anchoring
 * at end-of-file so patterns intended to match file endings apply at the end.
 */
export function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  updateFileMode: UpdateFileMode,
): number | null {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;

  const attempt = (searchStart: number): number | null => {
    const last = lines.length - pattern.length;
  const rowMatches = (
    i: number,
    eq: (a: string, b: string) => boolean,
  ): boolean => {
    for (let j = 0; j < pattern.length; j++) {
      if (!eq(lines[i + j], pattern[j])) return false;
    }
    return true;
  };

  // Pass 1: exact
  for (let i = searchStart; i <= last; i++) {
    if (rowMatches(i, (a, b) => a === b)) return i;
  }
  // Pass 2: ignore trailing whitespace
  for (let i = searchStart; i <= last; i++) {
    if (rowMatches(i, (a, b) => a.replace(/\s+$/, '') === b.replace(/\s+$/, ''))) return i;
  }
  // Pass 3: trim both sides
  for (let i = searchStart; i <= last; i++) {
    if (rowMatches(i, (a, b) => a.trim() === b.trim())) return i;
  }
    // Pass 4: Unicode punctuation normalization (mirrors git apply fuzziness)
    for (let i = searchStart; i <= last; i++) {
      if (rowMatches(i, (a, b) => normalise(a) === normalise(b))) return i;
    }
    return null;
  }

  const eofStart =
    eof && lines.length >= pattern.length ? lines.length - pattern.length : null;
  const primary =
    eofStart === null
      ? start
      : updateFileMode === 'NormalizeToLf'
        ? eofStart
        : Math.max(eofStart, start);

  // First try anchored at end-of-file, then fall back to `start` (docstring).
  const anchored = attempt(primary);
  if (anchored !== null) return anchored;
  if (primary !== start) return attempt(start);
  return null;
}
