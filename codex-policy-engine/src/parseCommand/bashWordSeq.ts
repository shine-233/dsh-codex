// Contract-faithful replacement for openai/codex shell-command/src/bash.rs
// (Apache-2.0, anchor rust-v0.153.4): upstream parses with tree-sitter-bash
// and walks the tree, accepting ONLY "word-only command sequences" joined by
// && || ; | — every named node must be one of program/list/pipeline/command/
// command_name/word/number/string/string_content/raw_string/concatenation,
// every word must be literal (no { } * ? [ ] \ ~ ^ # $ ` or =-prefix), every
// unnamed token must be whitespace or && || ; | " ', strings reject escapes
// and expansions, and variable assignments at command start are rejected.
//
// This module reproduces that acceptance contract with a hand-rolled lexer
// (zero deps, no WASM): same accepted set, same reject set, same output
// word-lists. The upstream bash.rs test cases are ported 1:1 in
// test/parseCommand.test.ts as the fidelity gate.
//
// Not ported by name, because there is no tree to walk:
//   try_parse_shell / try_parse_word_only_commands_sequence → folded into
//     parseShellScriptIntoCommands;
//   is_literal_word_or_number / parse_plain_command_from_node /
//   parse_literal_command_from_node / parse_literal_shell_word /
//   parse_double_quoted_string / parse_raw_string → replaced by the lexer's
//     piece rules below.
// The *other* bash.rs entry point, parse_shell_lc_literal_commands (tree-sitter
// literal extraction for the danger scanner), is not ported here either: its
// consumer path in commandSafety.ts is covered by splitInvocationSegments,
// which is behaviourally equivalent for that use (split on ; | || && newline,
// shlex each segment, recurse) but is not a node-faithful port.

export type WordSeq = string[][] | null

interface Piece {
  /** 'word' = unquoted literal piece; 'number'; 'string' = "..."-content; 'raw' = '...'-content */
  kind: 'word' | 'number' | 'string' | 'raw'
  text: string
}

/** Characters that make an unquoted tree-sitter word non-literal. */
const WORD_REJECT_CHARS = new Set([
  '{', '}', '*', '?', '[', ']', '\\', '~', '^', '#', '$', '`',
])

function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'
}

/** Chars tree-sitter folds into word tokens (operators/quotes handled first). */
function isWordChar(c: string): boolean {
  if (isWhitespace(c)) return false
  return !'&|;()<>$`{}`\\#"\''.includes(c)
}

function isPieceLiteralStart(p: Piece): boolean {
  // word pieces starting with '=' trip Zsh equals expansion upstream.
  return !(p.kind === 'word' && p.text.startsWith('='))
}

function pieceHasRejectChar(p: Piece): boolean {
  if (p.kind !== 'word' && p.kind !== 'number') return false
  for (const c of p.text) {
    if (WORD_REJECT_CHARS.has(c)) return true
  }
  return false
}

/**
 * Port of bash.rs parse_shell_script_into_commands: parse the script and
 * return the word-only command sequences, or null when the script contains
 * any construct outside the accepted word-only grammar.
 */
export function parseShellScriptIntoCommands(script: string): WordSeq {
  const commands: string[][] = []
  let pieces: Piece[] = [] // pieces of the current argument
  let args: string[] = [] // words of the current command
  let sawAnyCommand = false
  /** true while scanning the first word of a command (variable_assignment rule) */
  let atCommandStart = true
  /** whether the current argument started with a quoted piece (command_name rule) */
  let argStartedQuoted = false
  /**
   * "empty command segment" state, set by every separator (&& || | ; newline):
   * a second separator right after one is a parse error (except trailing `;`).
   */
  let awaitingCommand = true
  /** set only by && || | — a trailing one of these is a parse error (unlike ;). */
  let awaitingSeqOp = false

  const flushArg = (): boolean => {
    if (pieces.length === 0) return true
    // command_name rule: the first word of a command must be an unquoted word
    if (args.length === 0 && argStartedQuoted) return false
    for (const p of pieces) {
      if (pieceHasRejectChar(p)) return false
      if (!isPieceLiteralStart(p)) return false
    }
    if (
      atCommandStart &&
      args.length === 0 &&
      pieces[0].kind === 'word' &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(pieces[0].text)
    ) {
      // variable_assignment at command start (upstream: FOO=bar ls -> reject)
      return false
    }
    const wasFirst = args.length === 0
    args.push(pieces.map((p) => p.text).join(''))
    pieces = []
    argStartedQuoted = false
    atCommandStart = false
    if (wasFirst) {
      // the tree's command node exists as soon as its first word does
      awaitingCommand = false
      sawAnyCommand = true
    }
    return true
  }

  const flushCommand = (): boolean => {
    if (!flushArg()) return false
    if (args.length > 0) {
      commands.push(args)
      args = []
    }
    atCommandStart = true
    return true
  }

  const onSeqOp = (): boolean => {
    // && / || / | reject an empty segment on the left...
    if (awaitingCommand || !sawAnyCommand) return false
    if (!flushCommand()) return false
    awaitingCommand = true
    awaitingSeqOp = true
    return true
  }

  const iLen = script.length
  let i = 0
  while (i < iLen) {
    const c = script[i]
    if (isWhitespace(c)) {
      if (!flushArg()) return null
      if (c === '\n') {
        if (!flushCommand()) return null
        awaitingCommand = true
      }
      i++
      continue
    }
    if (c === '&' && script[i + 1] === '&') {
      if (!onSeqOp()) return null
      i += 2
      continue
    }
    if (c === '|' && script[i + 1] === '|') {
      if (!onSeqOp()) return null
      i += 2
      continue
    }
    if (c === '|') {
      if (!onSeqOp()) return null
      i++
      continue
    }
    if (c === ';') {
      // ';;' is the case-terminator token: parse error at top level.
      if (script[i + 1] === ';') return null
      if (!flushCommand()) return null
      awaitingCommand = true
      i++
      continue
    }
    if (
      c === '(' || c === ')' || c === '<' || c === '>' || c === '$' || c === '`' ||
      c === '#' || c === '\\' || c === '{' || c === '}' || c === '&'
    ) {
      // subshells, redirections, expansions, comments, escapes, braces, and
      // background '&' — all produce nodes/tokens outside the allowed set.
      return null
    }
    if (c === '"' || c === "'") {
      const quote = c
      const startKind: Piece['kind'] = quote === '"' ? 'string' : 'raw'
      if (pieces.length === 0) argStartedQuoted = args.length === 0
      i++
      let content = ''
      let closed = false
      while (i < iLen) {
        const q = script[i]
        if (q === quote) {
          closed = true
          i++
          break
        }
        if (quote === '"') {
          if (q === '\\') {
            // Upstream rejects a string whose source spelling contains the
            // escapes \ \$ \` \" \\ and \<newline>, but keeps other backslash
            // pairs (e.g. \n) as literal string_content.
            const nxt = script[i + 1]
            if (nxt === '$' || nxt === '`' || nxt === '"' || nxt === '\\' || nxt === '\n' || nxt === undefined) {
              return null
            }
            content += q + nxt
            i += 2
            continue
          }
          if (q === '$' || q === '`') return null // expansion child node
        }
        content += q
        i++
      }
      if (!closed) return null // unterminated quote = parse error
      pieces.push({ kind: startKind, text: content })
      continue
    }
    // unquoted word character run (operators/quotes handled above)
    let text = ''
    while (i < iLen) {
      const w = script[i]
      if (!isWordChar(w) || w === '"' || w === "'") break
      if (WORD_REJECT_CHARS.has(w)) return null
      if (w === '=' && text === '' && pieces.length === 0) return null
      text += w
      i++
    }
    if (text === '') return null // no progress: unknown punctuation token
    pieces.push({ kind: 'word', text })
  }
  if (!flushCommand()) return null
  // a trailing '&&'/'||'/'|' with no command after it is a parse error;
  // a trailing ';' (or newline) is legal, so both flags must be set.
  if (awaitingCommand && awaitingSeqOp) return null
  if (!sawAnyCommand) {
    // whitespace-only script: valid parse with zero commands (Some([]))
    return commands
  }
  return commands
}
