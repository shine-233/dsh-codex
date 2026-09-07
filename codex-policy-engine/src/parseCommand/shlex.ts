// Faithful port of the Rust `shlex` crate v1.3.0 (src/lib.rs + src/bytes.rs,
// MIT/Apache-2.0), as used by openai/codex shell-command/parse_command.rs
// (anchor rust-v0.153.4). Semantics pinned by the upstream test suite:
//  - split(): POSIX-ish lexer; '...' verbatim; "..." with backslash escapes
//    for $ ` " \ (and \<newline> = line continuation); outside quotes
//    backslash escapes the next char (backslash+newline dropped); '#' at
//    token start skips to end of line; NUL byte -> None; unmatched quote or
//    trailing backslash -> None.
//  - try_join()/quote(): chunked quoting per byte class:
//    unquoted_ok = [+ - . / : @ ] _ alnum]; single_quoted_ok = not ' ^ \;
//    double_quoted_ok = not $ ` ! ^; non-ASCII -> not unquoted; '^' at byte
//    0 forces single-quote-only start. Empty token -> ''. Strategy preference
//    per chunk: Unquoted > SingleQuoted > DoubleQuoted (double quotes escape
//    $ ` " \ with a backslash).

const NUL = 0

function isShlexWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n'
}

/**
 * Port of shlex::split. Returns null when the input contains a NUL byte,
 * has an unterminated quote, or ends with a dangling backslash.
 */
export function shlexSplit(inStr: string): string[] | null {
  if (inStr.includes(String.fromCharCode(NUL))) return null
  const out: string[] = []
  let i = 0
  const n = inStr.length
  let hadError = false

  const nextChar = (): string | null => (i < n ? inStr[i++] : null)

  function parseDouble(result: { s: string }): boolean {
    // Returns false on error (unterminated quote).
    for (;;) {
      const ch2 = nextChar()
      if (ch2 === null) return false
      if (ch2 === '\\') {
        const ch3 = nextChar()
        if (ch3 === null) return false
        if (ch3 === '$' || ch3 === '`' || ch3 === '"' || ch3 === '\\') {
          result.s += ch3
        } else if (ch3 === '\n') {
          // line continuation: dropped
        } else {
          result.s += '\\' + ch3
        }
      } else if (ch2 === '"') {
        return true
      } else {
        result.s += ch2
      }
    }
  }

  function parseSingle(result: { s: string }): boolean {
    for (;;) {
      const ch2 = nextChar()
      if (ch2 === null) return false
      if (ch2 === "'") return true
      result.s += ch2
    }
  }

  function parseWord(first: string): string {
    const result = { s: '' }
    let ch: string | null = first
    for (;;) {
      if (ch === '"') {
        if (!parseDouble(result)) {
          hadError = true
          return result.s // error signalled via hadError
        }
      } else if (ch === "'") {
        if (!parseSingle(result)) {
          hadError = true
          return result.s
        }
      } else if (ch === '\\') {
        const ch2 = nextChar()
        if (ch2 === null) {
          hadError = true
          return result.s
        }
        if (ch2 !== '\n') result.s += ch2
      } else if (isShlexWhitespace(ch)) {
        break
      } else {
        result.s += ch
      }
      ch = nextChar()
      if (ch === null) break
    }
    return result.s
  }

  for (;;) {
    let ch = nextChar()
    if (ch === null) break
    // skip initial whitespace; '#' starts a comment running to end of line
    for (;;) {
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        ch = nextChar()
        if (ch === null) return hadError ? null : out
        continue
      }
      if (ch === '#') {
        let c2 = nextChar()
        while (c2 !== null && c2 !== '\n') c2 = nextChar()
        ch = c2 // '\n' or null
        if (ch === null) return hadError ? null : out
        continue
      }
      break
    }
    const word = parseWord(ch)
    if (hadError) return null
    out.push(word)
  }
  return hadError ? null : out
}

function unquotedOk(c: string): boolean {
  if (c.charCodeAt(0) >= 0x80) return false
  return /^[+\-./:@\]_0-9A-Za-z]$/.test(c)
}

function singleQuotedOk(c: string): boolean {
  return c !== "'" && c !== '^' && c !== '\\'
}

function doubleQuotedOk(c: string): boolean {
  return c !== '$' && c !== '`' && c !== '!' && c !== '^'
}

const UNQUOTED = 1
const SINGLE = 2
const DOUBLE = 4

/** Longest prefix + best quoting strategy (Unquoted > Single > Double). */
function quotingStrategy(bytes: string[]): { len: number; strategy: number } {
  const prevAll = UNQUOTED | SINGLE | DOUBLE
  let prevOk = prevAll
  let i = 0
  if (bytes[0] === '^') {
    prevOk = SINGLE
    i = 1
  }
  while (i < bytes.length) {
    const c = bytes[i]
    let curOk = prevOk
    if (c.charCodeAt(0) >= 0x80) {
      curOk &= ~UNQUOTED
    } else {
      if (!unquotedOk(c)) curOk &= ~UNQUOTED
      if (!singleQuotedOk(c)) curOk &= ~SINGLE
      if (!doubleQuotedOk(c)) curOk &= ~DOUBLE
    }
    if (curOk === 0) break
    prevOk = curOk
    i += 1
  }
  const strategy =
    prevOk & UNQUOTED ? UNQUOTED : prevOk & SINGLE ? SINGLE : DOUBLE
  return { len: Math.max(i, 1), strategy }
}

function appendQuotedChunk(out: string, chunk: string[], strategy: number): string {
  if (strategy === UNQUOTED) return out + chunk.join('')
  if (strategy === SINGLE) return out + "'" + chunk.join('') + "'"
  // DoubleQuoted: escape $ ` " \ with a backslash
  let s = out + '"'
  for (const c of chunk) {
    if (c === '$' || c === '`' || c === '"' || c === '\\') s += '\\'
    s += c
  }
  return s + '"'
}

/** Port of shlex::quote (via the chunked bytes::quote). */
export function shlexQuote(inStr: string): string {
  if (inStr === '') return "''"
  if (inStr.includes(String.fromCharCode(NUL))) {
    throw new Error('cannot shell-quote string containing nul byte')
  }
  const bytes = [...inStr]
  let out = ''
  let rest = bytes
  while (rest.length > 0) {
    const { len, strategy } = quotingStrategy(rest)
    const chunk = rest.slice(0, len)
    if (len === rest.length && strategy === UNQUOTED && out === '') {
      return inStr
    }
    out = appendQuotedChunk(out, chunk, strategy)
    rest = rest.slice(len)
  }
  return out
}

/** Port of shlex::try_join — null on NUL byte. */
export function shlexTryJoin(tokens: string[]): string | null {
  for (const t of tokens) {
    if (t.includes(String.fromCharCode(NUL))) return null
  }
  return tokens.map(shlexQuote).join(' ')
}

/** parse_command.rs shlex_join: fallback string on NUL. */
export function shlexJoin(tokens: string[]): string {
  return shlexTryJoin(tokens) ?? '<command included NUL byte>'
}
