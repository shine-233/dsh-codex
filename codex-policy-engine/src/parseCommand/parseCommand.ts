// Faithful port of openai/codex shell-command/src/parse_command.rs
// (Apache-2.0, anchor rust-v0.153.4) — the command-metadata summarizer.
// The upstream entry comment says it best: the parsing is slightly lossy due
// to the ~infinite expressiveness of an arbitrary command; the goal is a
// human-readable gist. Every upstream unit test (lines 86-1422) is ported
// 1:1 in test/parseCommand.test.ts as the fidelity gate.
//
// Structure mirrors upstream:
//   parseCommand          = entry (dedup + unknown collapse)
//   parseCommandImpl      = token-space core
//   parseShellScript      = word-only script fast path (bash.rs contract)
//   summarizeMainTokens   = per-command classifier
import { shlexJoin, shlexSplit } from './shlex.js'
import { parseShellScriptIntoCommands } from './bashWordSeq.js'
import { classifyShell } from './shellDetect.js'
import { extractPowershellCommand } from './powershellExtract.js'

export type ParsedCommand =
  | { type: 'read'; cmd: string; name: string; path: string }
  | { type: 'list_files'; cmd: string; path: string | null }
  | { type: 'search'; cmd: string; query: string | null; path: string | null }
  | { type: 'unknown'; cmd: string }

function parsedEq(a: ParsedCommand, b: ParsedCommand): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── shlex helpers ────────────────────────────────────────────────────────────

/** Port of shlex::split with the tests' safe fallback (whitespace split). */
export function shlexSplitSafe(s: string): string[] {
  return shlexSplit(s) ?? s.split(/[ \t\n]+/).filter((t) => t !== '')
}

/**
 * Tokenizes a PowerShell command while preserving Windows paths and reader
 * aliases (upstream tokenize_powershell_command).
 */
export function tokenizePowershellCommand(command: string): string[] {
  const normalized = command.replace(/\\/g, '/')
  const tokens =
    shlexSplit(normalized) ??
    normalized.split(/[ \t\n]+/).filter((t) => t !== '')
  const first = tokens[0]
  if (first !== undefined && ['get-content', 'gc', 'type'].includes(first.toLowerCase())) {
    tokens[0] = 'Get-Content'
    // POSIX shlex must not silently rewrite a PowerShell file path.
    if (tokens.slice(1).some((argument) => !normalized.includes(argument))) {
      return []
    }
  }
  return tokens
}

/** Extracts the shell and script from a command, regardless of platform. */
export function extractShellCommand(command: string[]): [string, string] | null {
  return extractBashCommand(command) ?? extractPowershellCommand(command)
}

/** bash.rs extract_bash_command: exactly [shell, -lc|-c, script], bash/zsh/sh. */
export function extractBashCommand(command: string[]): [string, string] | null {
  if (command.length !== 3) return null
  const [shell, flag, script] = command
  if (flag !== '-lc' && flag !== '-c') return null
  const kind = classifyShell(shell)
  if (kind !== 'zsh' && kind !== 'bash' && kind !== 'sh') return null
  return [shell, script]
}

/**
 * Port of bash.rs `parse_shell_lc_plain_commands`: the word-only command
 * sequence inside a `bash -lc "..."` / `zsh -lc "..."` invocation, or null
 * when the script uses anything outside the accepted grammar.
 */
export function parseShellLcPlainCommands(command: string[]): string[][] | null {
  const extracted = extractBashCommand(command)
  if (extracted === null) return null
  return parseShellScriptIntoCommands(extracted[1])
}

// ── entry points ─────────────────────────────────────────────────────────────

export function parseCommand(command: string[]): ParsedCommand[] {
  // Parse and then collapse consecutive duplicate commands to avoid redundant summaries.
  const parsed = parseCommandImpl(command)
  const deduped: ParsedCommand[] = []
  for (const cmd of parsed) {
    const prev = deduped[deduped.length - 1]
    if (prev !== undefined && parsedEq(prev, cmd)) continue
    deduped.push(cmd)
  }
  if (deduped.some((cmd) => cmd.type === 'unknown')) {
    return [singleUnknownForCommand(command)]
  }
  return deduped
}

function singleUnknownForCommand(command: string[]): ParsedCommand {
  const extracted = extractShellCommand(command)
  if (extracted !== null) {
    return { type: 'unknown', cmd: extracted[1] }
  }
  return { type: 'unknown', cmd: shlexJoin(command) }
}

// ── simplification ───────────────────────────────────────────────────────────

function simplifyOnce(commands: ParsedCommand[]): ParsedCommand[] | null {
  if (commands.length <= 1) return null

  // echo ... && ...rest => ...rest
  if (commands[0].type === 'unknown') {
    const t = shlexSplit(commands[0].cmd)
    if (t !== null && t[0] === 'echo') return commands.slice(1)
  }

  // cd foo && [any command] => drop the cd when a command follows
  const cdIdx = commands.findIndex((pc) => {
    if (pc.type !== 'unknown') return false
    const t = shlexSplit(pc.cmd)
    return t !== null && t[0] === 'cd'
  })
  if (cdIdx !== -1 && commands.length > cdIdx + 1) {
    return [...commands.slice(0, cdIdx), ...commands.slice(cdIdx + 1)]
  }

  // cmd || true => cmd
  const trueIdx = commands.findIndex(
    (pc) => pc.type === 'unknown' && pc.cmd === 'true',
  )
  if (trueIdx !== -1) {
    return [...commands.slice(0, trueIdx), ...commands.slice(trueIdx + 1)]
  }

  // nl -[any_flags] && ...rest => drop the nl stage
  const nlIdx = commands.findIndex((pc) => {
    if (pc.type !== 'unknown') return false
    const t = shlexSplit(pc.cmd)
    return t !== null && t[0] === 'nl' && t.slice(1).every((x) => x.startsWith('-'))
  })
  if (nlIdx !== -1) {
    return [...commands.slice(0, nlIdx), ...commands.slice(nlIdx + 1)]
  }

  return null
}

// ── sed ──────────────────────────────────────────────────────────────────────

/** Validates that this is a `sed -n 123,123p` style range argument. */
function isValidSedNArg(arg: string | null): boolean {
  if (arg === null) return false
  if (!arg.endsWith('p')) return false
  const core = arg.slice(0, -1)
  const parts = core.split(',')
  if (parts.length === 1) {
    const num = parts[0]
    return num !== '' && /^[0-9]+$/.test(num)
  }
  if (parts.length === 2) {
    const [a, b] = parts
    return a !== '' && b !== '' && /^[0-9]+$/.test(a) && /^[0-9]+$/.test(b)
  }
  return false
}

function sedHasInPlaceFlag(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '--') break
    if (token === '-e' || token === '-f' || token === '--expression' || token === '--file') {
      i++ // consume the value
      continue
    }
    if (token === '--in-place') return true
    if (token.startsWith('--in-place=')) return true
    if (token.startsWith('--')) continue
    if (token.startsWith('-')) {
      const shortOptions = token.slice(1)
      for (let index = 0; index < shortOptions.length; index++) {
        const option = shortOptions[index]
        if (option === 'i') return true
        if (option === 'e' || option === 'f') {
          // -e/-f consume the next token only when they end the cluster
          if (index + option.length === shortOptions.length) i++
          break
        }
      }
    }
  }
  return false
}

function sedReadPath(args: string[]): string | null {
  const argsNoConnector = trimAtConnector(args)
  if (sedHasInPlaceFlag(argsNoConnector) || !argsNoConnector.some((arg) => arg === '-n')) {
    return null
  }
  let hasRangeScript = false
  let i = 0
  while (i < argsNoConnector.length) {
    const arg = argsNoConnector[i]
    if (arg === '-e' || arg === '--expression') {
      if (isValidSedNArg(argsNoConnector[i + 1] ?? null)) hasRangeScript = true
      i += 2
      continue
    }
    if (arg === '-f' || arg === '--file') {
      i += 2
      continue
    }
    i += 1
  }
  if (!hasRangeScript) {
    hasRangeScript = argsNoConnector.some(
      (arg) => !arg.startsWith('-') && isValidSedNArg(arg),
    )
  }
  if (!hasRangeScript) return null
  const candidates = skipFlagValues(argsNoConnector, [
    '-e', '-f', '--expression', '--file',
  ])
  const nonFlags = candidates.filter((arg) => !arg.startsWith('-'))
  if (nonFlags.length === 0) return null
  const [first, ...rest] = nonFlags
  if (isValidSedNArg(first)) return rest[0] ?? null
  return first
}

// ── token normalization and splitting ────────────────────────────────────────

/**
 * Normalize a command by:
 * - Removing `yes`/`no`/`bash -c`/`bash -lc`/`zsh -c`/`zsh -lc` prefixes.
 * - Splitting `bash -lc "script"`-style wrappers via shlex.
 */
function normalizeTokens(cmd: string[]): string[] {
  if (
    cmd.length >= 3 &&
    (cmd[0] === 'yes' || cmd[0] === 'y') &&
    cmd[1] === '|'
  ) {
    // Do not re-shlex already-tokenized input; just drop the prefix.
    return cmd.slice(2)
  }
  if (
    cmd.length >= 3 &&
    (cmd[0] === 'no' || cmd[0] === 'n') &&
    cmd[1] === '|'
  ) {
    return cmd.slice(2)
  }
  if (
    cmd.length === 3 &&
    (cmd[0] === 'bash' || cmd[0] === 'zsh') &&
    (cmd[1] === '-c' || cmd[1] === '-lc')
  ) {
    return shlexSplit(cmd[2]) ?? [cmd[0], cmd[1], cmd[2]]
  }
  return [...cmd]
}

function containsConnectors(tokens: string[]): boolean {
  return tokens.some((t) => t === '&&' || t === '||' || t === '|' || t === ';')
}

function splitOnConnectors(tokens: string[]): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  for (const t of tokens) {
    if (t === '&&' || t === '||' || t === '|' || t === ';') {
      if (cur.length > 0) {
        out.push(cur)
        cur = []
      }
    } else {
      cur.push(t)
    }
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function trimAtConnector(tokens: string[]): string[] {
  const idx = tokens.findIndex((t) => t === '|' || t === '&&' || t === '||' || t === ';')
  return idx === -1 ? tokens.slice() : tokens.slice(0, idx)
}

/**
 * Shorten a path to the last component, excluding `build`/`dist`/
 * `node_modules`/`src`. Also pulls out a useful path from a directory such as
 * webview/src -> webview, foo/src/ -> foo, packages/app/node_modules/ -> app.
 */
function shortDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const trimmed = normalized.replace(/\/+$/, '')
  const parts = trimmed.split('/').reverse().filter((p) => {
    return p !== '' && p !== 'build' && p !== 'dist' && p !== 'node_modules' && p !== 'src'
  })
  return parts[0] ?? trimmed
}

/** Skip values consumed by specific flags and ignore --flag=value arguments. */
function skipFlagValues(args: string[], flagsWithVals: string[]): string[] {
  const out: string[] = []
  let skipNext = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (skipNext) {
      skipNext = false
      continue
    }
    if (a === '--') {
      // From here on, everything is positional operands.
      for (const rest of args.slice(i + 1)) out.push(rest)
      break
    }
    if (a.startsWith('--') && a.includes('=')) continue
    if (flagsWithVals.includes(a)) {
      // This flag consumes the next argument as its value.
      if (i + 1 < args.length) skipNext = true
      continue
    }
    out.push(a)
  }
  return out
}

function firstNonFlagOperand(args: string[], flagsWithVals: string[]): string | null {
  return positionalOperands(args, flagsWithVals)[0] ?? null
}

function singleNonFlagOperand(args: string[], flagsWithVals: string[]): string | null {
  const operands = positionalOperands(args, flagsWithVals)
  if (operands.length !== 1) return null
  return operands[0]
}

function positionalOperands(args: string[], flagsWithVals: string[]): string[] {
  const out: string[] = []
  let afterDoubleDash = false
  let skipNext = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (skipNext) {
      skipNext = false
      continue
    }
    if (afterDoubleDash) {
      out.push(arg)
      continue
    }
    if (arg === '--') {
      afterDoubleDash = true
      continue
    }
    if (arg.startsWith('--') && arg.includes('=')) continue
    if (flagsWithVals.includes(arg)) {
      if (i + 1 < args.length) skipNext = true
      continue
    }
    if (arg.startsWith('-')) continue
    out.push(arg)
  }
  return out
}

// ── per-tool parsers ─────────────────────────────────────────────────────────

function parseGrepLike(mainCmd: string[], args: string[]): ParsedCommand {
  const argsNoConnector = trimAtConnector(args)
  const operands: string[] = []
  let pattern: string | null = null
  let afterDoubleDash = false
  const valueFlags = new Set([
    '-e', '--regexp', '-f', '--file',
    '-m', '--max-count', '-C', '--context', '-A', '--after-context', '-B', '--before-context',
  ])
  for (let i = 0; i < argsNoConnector.length; i++) {
    const arg = argsNoConnector[i]
    if (afterDoubleDash) {
      operands.push(arg)
      continue
    }
    if (arg === '--') {
      afterDoubleDash = true
      continue
    }
    if (arg === '-e' || arg === '--regexp' || arg === '-f' || arg === '--file') {
      const next = argsNoConnector[i + 1]
      if (next !== undefined && pattern === null) pattern = next
      if (valueFlags.has(arg)) i++
      continue
    }
    if (valueFlags.has(arg)) {
      i++
      continue
    }
    if (arg.startsWith('-')) continue
    operands.push(arg)
  }
  // Do not shorten the query: grep patterns may legitimately contain slashes
  // and should be preserved verbatim. Only paths should be shortened.
  const hasPattern = pattern !== null
  const query = pattern ?? operands[0] ?? null
  const pathIndex = hasPattern ? 0 : 1
  const path = operands[pathIndex] !== undefined ? shortDisplayPath(operands[pathIndex]) : null
  return { type: 'search', cmd: shlexJoin(mainCmd), query, path }
}

function awkDataFileOperand(args: string[]): string | null {
  if (args.length === 0) return null
  const argsNoConnector = trimAtConnector(args)
  const hasScriptFile = argsNoConnector.some((arg) => arg === '-f' || arg === '--file')
  const candidates = skipFlagValues(argsNoConnector, [
    '-F', '-v', '-f', '--field-separator', '--assign', '--file',
  ])
  const nonFlags = candidates.filter((arg) => !arg.startsWith('-'))
  if (hasScriptFile) return nonFlags[0] ?? null
  if (nonFlags.length >= 2) return nonFlags[1]
  return null
}

function pythonWalksFiles(args: string[]): boolean {
  const argsNoConnector = trimAtConnector(args)
  for (let i = 0; i < argsNoConnector.length; i++) {
    if (argsNoConnector[i] === '-c') {
      const script = argsNoConnector[i + 1]
      if (script === undefined) return false
      return (
        script.includes('os.walk') ||
        script.includes('os.listdir') ||
        script.includes('os.scandir') ||
        script.includes('glob.glob') ||
        script.includes('glob.iglob') ||
        script.includes('pathlib.Path') ||
        script.includes('.rglob(')
      )
    }
  }
  return false
}

function isPythonCommand(cmd: string): boolean {
  return (
    cmd === 'python' || cmd === 'python2' || cmd === 'python3' ||
    cmd.startsWith('python2.') || cmd.startsWith('python3.')
  )
}

function cdTarget(args: string[]): string | null {
  if (args.length === 0) return null
  let target: string | null = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') return args[i + 1] ?? null
    if (arg === '-L' || arg === '-P') continue
    if (arg.startsWith('-')) continue
    target = arg
  }
  return target
}

/** Returns whether a command token has an explicit path shape. */
export function isPathish(s: string): boolean {
  return (
    s === '.' || s === '..' || s.startsWith('./') || s.startsWith('../') ||
    s.includes('/') || s.includes('\\')
  )
}

function parseFdQueryAndPath(tail: string[]): [string | null, string | null] {
  const argsNoConnector = trimAtConnector(tail)
  // fd has several flags that take values (e.g., -t/--type, -e/--extension).
  const candidates = skipFlagValues(argsNoConnector, [
    '-t', '--type', '-e', '--extension', '-E', '--exclude', '--search-path',
  ])
  const nonFlags = candidates.filter((p) => !p.startsWith('-'))
  if (nonFlags.length === 1) {
    const one = nonFlags[0]
    if (isPathish(one)) return [null, shortDisplayPath(one)]
    return [one, null]
  }
  if (nonFlags.length >= 2) return [nonFlags[0], shortDisplayPath(nonFlags[1])]
  return [null, null]
}

function parseFindQueryAndPath(tail: string[]): [string | null, string | null] {
  const argsNoConnector = trimAtConnector(tail)
  // First positional argument (excluding common unary operators) is the root path
  let path: string | null = null
  for (const a of argsNoConnector) {
    if (!a.startsWith('-') && a !== '!' && a !== '(' && a !== ')') {
      path = shortDisplayPath(a)
      break
    }
  }
  // Extract a common name/path/regex pattern if present
  let query: string | null = null
  for (let i = 0; i < argsNoConnector.length; i++) {
    const a = argsNoConnector[i]
    if (a === '-name' || a === '-iname' || a === '-path' || a === '-regex') {
      if (i + 1 < argsNoConnector.length) query = argsNoConnector[i + 1]
      break
    }
  }
  return [query, path]
}

// ── tree-dependent fast path ─────────────────────────────────────────────────

function parseShellLcCommands(original: string[]): ParsedCommand[] | null {
  // Only handle bash/zsh here; PowerShell is stripped separately without bash parsing.
  const extracted = extractBashCommand(original)
  if (extracted === null) return null
  return parseShellScript(extracted[1])
}

/** Parses command metadata from a Bash-compatible shell script. */
export function parseShellScript(script: string): ParsedCommand[] {
  const allCommands = parseShellScriptIntoCommands(script)
  if (allCommands !== null && allCommands.length > 0) {
    const scriptTokens = shlexSplit(script) ?? [script]
    // Strip small formatting helpers (e.g., head/tail/awk/wc/etc) so we
    // bias toward the primary command when pipelines are present.
    const hadMultipleCommands = allCommands.length > 1
    const filteredCommands = dropSmallFormattingCommands(allCommands)
    if (filteredCommands.length === 0) {
      return [{ type: 'unknown', cmd: script }]
    }
    // Build parsed commands, tracking `cd` segments to compute effective paths.
    const commands: ParsedCommand[] = []
    let cwd: string | null = null
    for (const tokens of filteredCommands) {
      if (tokens[0] === 'cd') {
        const dir = cdTarget(tokens.slice(1))
        if (dir !== null) {
          cwd = cwd === null ? dir : joinPaths(cwd, dir)
        }
        continue
      }
      const parsed = summarizeMainTokens(tokens)
      if (parsed.type === 'read' && cwd !== null) {
        commands.push({
          ...parsed,
          path: joinPaths(cwd, parsed.path),
        })
      } else {
        commands.push(parsed)
      }
    }

    if (commands.length > 1) {
      const kept = commands.filter(
        (pc) => !(pc.type === 'unknown' && pc.cmd === 'true'),
      )
      commands.length = 0
      commands.push(...kept)
      // Apply the same simplifications used for non-bash parsing, e.g., drop leading `cd`.
      for (;;) {
        const next = simplifyOnce(commands)
        if (next === null) break
        commands.length = 0
        commands.push(...next)
      }
    }
    if (commands.length === 1) {
      // If we reduced to a single command, attribute the full original script
      // for clearer UX in file-reading and listing scenarios, or when there
      // were no connectors in the original script. For pipeline commands
      // (e.g. `rg --files | sed -n`), keep only the primary command.
      const hadConnectors =
        hadMultipleCommands ||
        scriptTokens.some((t) => t === '|' || t === '&&' || t === '||' || t === ';')
      const pc = commands[0]
      if (pc.type === 'read') {
        if (hadConnectors) {
          const hasPipe = scriptTokens.some((t) => t === '|')
          const hasSedN = scriptTokens.some(
            (t, i) => t === 'sed' && scriptTokens[i + 1] === '-n',
          )
          if (hasPipe && hasSedN) {
            commands[0] = { ...pc, cmd: script }
          }
        } else {
          commands[0] = { ...pc, cmd: shlexJoin(scriptTokens) }
        }
      } else if (pc.type === 'list_files') {
        if (!hadConnectors) {
          commands[0] = { ...pc, cmd: shlexJoin(scriptTokens) }
        }
      } else if (pc.type === 'search') {
        if (!hadConnectors) {
          commands[0] = { ...pc, cmd: shlexJoin(scriptTokens) }
        }
      }
    }
    return commands
  }
  return [{ type: 'unknown', cmd: script }]
}

// ── small formatting helpers / xargs ─────────────────────────────────────────

/**
 * Return true if this looks like a small formatting helper in a pipeline.
 * Examples: `head -n 40`, `tail -n +10`, `wc -l`, `awk ...`, `cut ...`, `tr ...`.
 * We try to keep variants that clearly include a file path (e.g. `tail -n 30 file`).
 */
export function isSmallFormattingCommand(tokens: string[]): boolean {
  if (tokens.length === 0) return false
  const cmd = tokens[0]
  switch (cmd) {
    // Always formatting; typically used in pipes.
    // `nl` is special-cased to allow `nl <file>` to be treated as a read command.
    case 'wc': case 'tr': case 'cut': case 'sort': case 'uniq':
    case 'tee': case 'column': case 'yes': case 'printf':
      return true
    case 'xargs':
      return !isMutatingXargsCommand(tokens)
    case 'awk':
      return awkDataFileOperand(tokens.slice(1)) === null
    case 'head': {
      // Treat as formatting when no explicit file operand is present.
      if (tokens.length === 1) return true
      if (tokens.length === 2) return tokens[1].startsWith('-')
      // `head -n 40` / `head -c 100` (no file operand) — exactly 3 tokens.
      if (tokens.length === 3) {
        const [flag, count] = [tokens[1], tokens[2]]
        if ((flag === '-n' || flag === '-c') && /^[0-9]+$/.test(count)) return true
      }
      return false
    }
    case 'tail': {
      // Treat as formatting when no explicit file operand is present.
      if (tokens.length === 1) return true
      if (tokens.length === 2) return tokens[1].startsWith('-')
      // `tail -n 30` / `tail -n +10` / `tail -c 100` / `tail -c +10` (no file operand).
      if (tokens.length === 3) {
        const [flag, count] = [tokens[1], tokens[2]]
        if (flag === '-n' || flag === '-c') {
          const digits = count.startsWith('+') ? count.slice(1) : count
          if (/^[0-9]+$/.test(digits)) return true
        }
      }
      return false
    }
    case 'sed': {
      // Keep `sed -n <range> file` (treated as a file read elsewhere);
      // keep in-place mutations as unknown actions; otherwise consider it
      // a formatting helper in a pipeline.
      const args = tokens.slice(1)
      return !sedHasInPlaceFlag(args) && sedReadPath(args) === null
    }
    default:
      return false
  }
}

function isMutatingXargsCommand(tokens: string[]): boolean {
  const sub = xargsSubcommand(tokens)
  return sub !== null && xargsIsMutatingSubcommand(sub)
}

function xargsSubcommand(tokens: string[]): string[] | null {
  if (tokens[0] !== 'xargs') return null
  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === '--') {
      const rest = tokens.slice(i + 1)
      return rest.length > 0 ? rest : null
    }
    if (!token.startsWith('-')) {
      const rest = tokens.slice(i)
      return rest.length > 0 ? rest : null
    }
    const takesValue = ['-E', '-e', '-I', '-L', '-n', '-P', '-s'].includes(token)
    if (takesValue && token.length === 2) {
      i += 2
    } else {
      i += 1
    }
  }
  return null
}

function xargsIsMutatingSubcommand(tokens: string[]): boolean {
  if (tokens.length === 0) return false
  const [head, ...tail] = tokens
  switch (head) {
    case 'perl': case 'ruby':
      return hasInPlaceFlag(tail)
    case 'sed':
      return sedHasInPlaceFlag(tail)
    case 'rg':
      return tail.some((token) => token === '--replace')
    default:
      return false
  }
}

function hasInPlaceFlag(tokens: string[]): boolean {
  return tokens.some(
    (token) =>
      token === '-i' ||
      token.startsWith('-i') ||
      token === '-pi' ||
      token.startsWith('-pi') ||
      token === '--in-place' ||
      token.startsWith('--in-place='),
  )
}

function dropSmallFormattingCommands(commands: string[][]): string[][] {
  return commands.filter((tokens) => !isSmallFormattingCommand(tokens))
}

// ── the classifier ───────────────────────────────────────────────────────────

function summarizeMainTokens(mainCmd: string[]): ParsedCommand {
  const head = mainCmd[0]
  const tail = mainCmd.slice(1)
  const join = () => shlexJoin(mainCmd)

  // Upstream `match main_cmd.split_first()` falls through to the catch-all
  // `Unknown { cmd: shlex_join(main_cmd) }` arm, which for an empty slice is "".
  if (head === undefined) return { type: 'unknown', cmd: join() }

  if (head === 'ls' || head === 'eza' || head === 'exa') {
    const flagsWithVals =
      head === 'ls'
        ? ['-I', '-w', '--block-size', '--format', '--time-style', '--color', '--quoting-style']
        : ['-I', '--ignore-glob', '--color', '--sort', '--time-style', '--time']
    const p = firstNonFlagOperand(tail, flagsWithVals)
    return { type: 'list_files', cmd: join(), path: p !== null ? shortDisplayPath(p) : null }
  }
  if (head === 'tree') {
    const p = firstNonFlagOperand(tail, ['-L', '-P', '-I', '--charset', '--filelimit', '--sort'])
    return { type: 'list_files', cmd: join(), path: p !== null ? shortDisplayPath(p) : null }
  }
  if (head === 'du') {
    const p = firstNonFlagOperand(tail, [
      '-d', '--max-depth', '-B', '--block-size', '--exclude', '--time-style',
    ])
    return { type: 'list_files', cmd: join(), path: p !== null ? shortDisplayPath(p) : null }
  }
  if (head === 'rg' || head === 'rga' || head === 'ripgrep-all') {
    const argsNoConnector = trimAtConnector(tail)
    const hasFilesFlag = argsNoConnector.some((a) => a === '--files')
    const candidates = skipFlagValues(argsNoConnector, [
      '-g', '--glob', '--iglob', '-t', '--type', '--type-add', '--type-not',
      '-m', '--max-count', '-A', '-B', '-C', '--context', '--max-depth',
    ])
    const nonFlags = candidates.filter((p) => !p.startsWith('-'))
    if (hasFilesFlag) {
      const p = nonFlags[0]
      return { type: 'list_files', cmd: join(), path: p !== undefined ? shortDisplayPath(p) : null }
    }
    const query = nonFlags[0] ?? null
    const p = nonFlags[1]
    return { type: 'search', cmd: join(), query, path: p !== undefined ? shortDisplayPath(p) : null }
  }
  if (head === 'git') {
    const subcmd = tail[0]
    const subTail = tail.slice(1)
    if (subcmd === 'grep') return parseGrepLike(mainCmd, subTail)
    if (subcmd === 'ls-files') {
      const p = firstNonFlagOperand(subTail, [
        '--exclude', '--exclude-from', '--pathspec-from-file',
      ])
      return { type: 'list_files', cmd: join(), path: p !== null ? shortDisplayPath(p) : null }
    }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'fd') {
    const [query, path] = parseFdQueryAndPath(tail)
    if (query !== null) return { type: 'search', cmd: join(), query, path }
    return { type: 'list_files', cmd: join(), path }
  }
  if (head === 'find') {
    // Basic find support: capture path and common name filter
    const [query, path] = parseFindQueryAndPath(tail)
    if (query !== null) return { type: 'search', cmd: join(), query, path }
    return { type: 'list_files', cmd: join(), path }
  }
  if (head === 'grep' || head === 'egrep' || head === 'fgrep') {
    return parseGrepLike(mainCmd, tail)
  }
  if (head === 'ag' || head === 'ack' || head === 'pt') {
    const argsNoConnector = trimAtConnector(tail)
    const candidates = skipFlagValues(argsNoConnector, [
      '-G', '-g', '--file-search-regex', '--ignore-dir', '--ignore-file', '--path-to-ignore',
    ])
    const nonFlags = candidates.filter((p) => !p.startsWith('-'))
    const query = nonFlags[0] ?? null
    const p = nonFlags[1]
    return { type: 'search', cmd: join(), query, path: p !== undefined ? shortDisplayPath(p) : null }
  }
  if (head === 'cat' || head.toLowerCase() === 'get-content') {
    let path: string | null
    if (head === 'cat') {
      path = singleNonFlagOperand(tail, [])
    } else {
      // Intentionally miss complex reads: conservative presentation should not
      // require implementing PowerShell's full expression and argument grammar.
      const allowedFlags = ['-raw', '-path', '-literalpath']
      const simple =
        tail.every(
          (argument) =>
            !argument.startsWith('-') || allowedFlags.includes(argument.toLowerCase()),
        )
          ? singleNonFlagOperand(tail, [])
          : null
      // Upstream: Option::filter — keep the path only when the predicate holds.
      path =
        simple !== null &&
        simple !== '' &&
        !simple.startsWith('-') &&
        [...simple].every(
          (character) =>
            /[\p{L}\p{N}]/u.test(character) || ' /\\.-_:'.includes(character),
        )
          ? simple
          : null
    }
    if (path !== null) {
      return { type: 'read', cmd: join(), name: shortDisplayPath(path), path }
    }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'bat' || head === 'batcat') {
    const p = singleNonFlagOperand(tail, [
      '--theme', '--language', '--style', '--terminal-width', '--tabs', '--line-range', '--map-syntax',
    ])
    if (p !== null) return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'less') {
    const p = singleNonFlagOperand(tail, [
      '-p', '-P', '-x', '-y', '-z', '-j', '--pattern', '--prompt', '--tabs', '--shift', '--jump-target',
    ])
    if (p !== null) return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'more') {
    const p = singleNonFlagOperand(tail, [])
    if (p !== null) return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'head') {
    // Support `head -n 50 file` and `head -n50 file` forms.
    let hasValidN = false
    if (tail[0] === '-n') {
      hasValidN = tail[1] !== undefined && /^[0-9]+$/.test(tail[1])
    } else if (tail[0]?.startsWith('-n')) {
      hasValidN = /^[0-9]+$/.test(tail[0].slice(2))
    }
    if (hasValidN) {
      // Build candidates skipping the numeric value consumed by `-n` when separated.
      const candidates: string[] = []
      let i = 0
      while (i < tail.length) {
        if (i === 0 && tail[i] === '-n' && i + 1 < tail.length) {
          const n = tail[i + 1]
          if (/^[0-9]+$/.test(n)) {
            i += 2
            continue
          }
        }
        candidates.push(tail[i])
        i += 1
      }
      const p = candidates.find((p) => !p.startsWith('-'))
      if (p !== undefined) {
        return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
      }
    }
    if (tail.length === 1 && !tail[0].startsWith('-')) {
      return { type: 'read', cmd: join(), name: shortDisplayPath(tail[0]), path: tail[0] }
    }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'tail') {
    // Support `tail -n +10 file` and `tail -n+10 file` forms.
    const validCount = (s: string): boolean => {
      const digits = s.startsWith('+') ? s.slice(1) : s
      return digits !== '' && /^[0-9]+$/.test(digits)
    }
    let hasValidN = false
    if (tail[0] === '-n') {
      hasValidN = tail[1] !== undefined && validCount(tail[1])
    } else if (tail[0]?.startsWith('-n')) {
      hasValidN = validCount(tail[0].slice(2))
    }
    if (hasValidN) {
      const candidates: string[] = []
      let i = 0
      while (i < tail.length) {
        if (i === 0 && tail[i] === '-n' && i + 1 < tail.length) {
          const n = tail[i + 1]
          if (validCount(n)) {
            i += 2
            continue
          }
        }
        candidates.push(tail[i])
        i += 1
      }
      const p = candidates.find((p) => !p.startsWith('-'))
      if (p !== undefined) {
        return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
      }
    }
    if (tail.length === 1 && !tail[0].startsWith('-')) {
      return { type: 'read', cmd: join(), name: shortDisplayPath(tail[0]), path: tail[0] }
    }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'awk') {
    const p = awkDataFileOperand(tail)
    if (p !== null) return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'nl') {
    // Avoid treating option values as paths (e.g., nl -s "  ").
    const candidates = skipFlagValues(tail, ['-s', '-w', '-v', '-i', '-b'])
    const p = candidates.find((p) => !p.startsWith('-'))
    if (p !== undefined) {
      return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
    }
    return { type: 'unknown', cmd: join() }
  }
  if (head === 'sed') {
    const p = sedReadPath(tail)
    if (p !== null) return { type: 'read', cmd: join(), name: shortDisplayPath(p), path: p }
    return { type: 'unknown', cmd: join() }
  }
  if (isPythonCommand(head)) {
    if (pythonWalksFiles(tail)) {
      return { type: 'list_files', cmd: join(), path: null }
    }
    return { type: 'unknown', cmd: join() }
  }
  // Other commands
  return { type: 'unknown', cmd: join() }
}

// ── path helpers ─────────────────────────────────────────────────────────────

function isAbsLike(path: string): boolean {
  if (path.startsWith('/')) return true
  if (/^[A-Za-z]:\\/.test(path)) return true
  if (path.startsWith('\\\\')) return true
  return false
}

function joinPaths(base: string, rel: string): string {
  if (isAbsLike(rel)) return rel
  if (base === '') return rel
  return base.endsWith('/') ? base + rel : base + '/' + rel
}

// ── the token-space core ─────────────────────────────────────────────────────

export function parseCommandImpl(command: string[]): ParsedCommand[] {
  const shellLc = parseShellLcCommands(command)
  if (shellLc !== null) return shellLc

  const head = command[0]
  const powershellCommand =
    head !== undefined && head.includes('\\')
      ? command.map((t, i) => (i === 0 ? head.split(/[\\/]/).pop() ?? head : t))
      : null
  const ps = extractPowershellCommand(powershellCommand ?? command)
  if (ps !== null) {
    const [, script] = ps
    const tokens = tokenizePowershellCommand(script)
    const innerParsed = parseCommandImpl(tokens)
    if (
      tokens[0] === 'Get-Content' &&
      innerParsed.length === 1 &&
      innerParsed[0].type === 'read'
    ) {
      const inner = innerParsed[0]
      return [{ type: 'read', cmd: script, name: inner.name, path: inner.path }]
    }
    return [{ type: 'unknown', cmd: script }]
  }

  const normalized = normalizeTokens(command)

  const parts = containsConnectors(normalized)
    ? splitOnConnectors(normalized)
    : [normalized]

  // Preserve left-to-right execution order for all commands, including
  // bash -c/-lc so summaries reflect the order they will run.
  const commands: ParsedCommand[] = []
  let cwd: string | null = null
  for (const tokens of parts) {
    if (tokens[0] === 'cd') {
      const dir = cdTarget(tokens.slice(1))
      if (dir !== null) {
        cwd = cwd === null ? dir : joinPaths(cwd, dir)
      }
      continue
    }
    const parsed = summarizeMainTokens(tokens)
    if (parsed.type === 'read' && cwd !== null) {
      commands.push({ ...parsed, path: joinPaths(cwd, parsed.path) })
    } else {
      commands.push(parsed)
    }
  }

  for (;;) {
    const next = simplifyOnce(commands)
    if (next === null) break
    commands.length = 0
    commands.push(...next)
  }

  return commands
}
