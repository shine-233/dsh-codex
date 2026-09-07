// Port of openai/codex shell-command dangerous-command classifier (Apache-2.0).
// Distilled from codex-rs/shell-command/src/command_safety/{is_dangerous_command,windows_dangerous_commands}.rs
// at upstream anchor rust-v0.153.4, including the 0.153.4 executable-basename
// drive-letter fix. Simplifications vs upstream (documented, best-effort):
// - shell literal-command recursion covers `<sh> -c <script>` invocations
//   (upstream additionally walks script FILES via parse_command.rs);
// - the PowerShell invocation parser is a shlex-style best-effort, not a full PS parser.
// Semantic line parsing (quotes/substitutions/heredocs) lives in shellParser.ts.
import { shellSubCommands } from './shellParser.js'
import { shlexSplit } from './parseCommand/shlex.js'

export type DangerousPlatform = 'posix' | 'windows'
export type DangerousMatch = 'ForcedRm' | 'Other'

export const MAX_WRAPPER_DEPTH = 8

const WINDOWS_EXEC_SUFFIXES = ['.exe', '.cmd', '.bat', '.com']

const DELETE_CMDLETS = ['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir']
const SEG_SEPS = [';', '|', '&', '\n', '\r', '\t']
const SOFT_SEPS = ['{', '}', '(', ')', '[', ']', ',', ';']

/** Quote-aware word split (shlex-style). Returns null on unbalanced quotes. */
/**
 * Re-exported from the faithful shlex 1.3.0 port (upstream `command_safety.rs`
 * calls the same `shlex::split`). Kept as the single shlex implementation in
 * this package so danger detection and command parsing cannot diverge.
 */
export { shlexSplit } from './parseCommand/shlex.js';

/** Split a command line into pipeline/sequence segments, then tokenize each. */
export function splitInvocationSegments(line: string): string[][] {
  const segments: string[][] = []
  let cur = ''
  let q: string | null = null
  const flush = () => {
    const words = shlexSplit(cur.trim())
    if (words && words.length) segments.push(words)
    cur = ''
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue }
    if (ch === ';' || ch === '\n') { flush(); continue }
    if (ch === '|') { flush(); if (line[i + 1] === '|') i++; continue }
    if (ch === '&') { flush(); if (line[i + 1] === '&') i++; continue }
    cur += ch
  }
  flush()
  return segments
}

/**
 * Windows basename: last path segment over both slash kinds, then the
 * rust-v0.153.4 drive-letter fix (a leading `C:` is stripped only when it is
 * a single ASCII letter followed by a colon).
 */
export function executableBasename(exe: string): string | null {
  const name = exe.split(/[\\/]/).pop() ?? ''
  if (!name) return null
  let stripped = name
  const m = /^([A-Za-z]):(.*)$/.exec(stripped)
  if (m) stripped = m[2]
  return stripped ? stripped.toLowerCase() : null
}

/** exec rules lookup key: basename + (windows) executable-suffix strip + lowercase. */
export function executableNameLookupKey(raw: string, platform: DangerousPlatform): string | null {
  if (platform === 'posix') {
    const name = raw.split('/').pop() ?? ''
    return name || null
  }
  let name = raw.split(/[\\/]/).pop() ?? ''
  if (!name) return null
  const drive = /^([A-Za-z]):(.*)$/.exec(name)
  if (drive) name = drive[2]
  name = name.toLowerCase()
  for (const suffix of WINDOWS_EXEC_SUFFIXES) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length)
  }
  return name || null
}

function isPowershellExecutable(exe: string): boolean {
  const base = executableBasename(exe)
  return base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe'
}

function isBrowserExecutable(name: string): boolean {
  return ['chrome', 'chrome.exe', 'msedge', 'msedge.exe', 'firefox', 'firefox.exe', 'iexplore', 'iexplore.exe'].includes(name)
}

function looksLikeUrl(token: string): boolean {
  // Port of upstream looks_like_url: first grab the substring starting at the
  // first http(s):// prefix (tokens like Start-Process('https://…') embed the
  // URL alongside other text), then strip PowerShell punctuation around it.
  const lower = token.toLowerCase()
  const httpsAt = lower.indexOf('https://')
  const httpAt = lower.indexOf('http://')
  const idx = httpsAt !== -1 && (httpAt === -1 || httpsAt < httpAt) ? httpsAt : httpAt
  const urlish = idx !== -1 ? token.slice(idx) : token
  const m = /^[ "'(]*([^\s"');]+)[\s;)]*$/.exec(urlish)
  if (!m) return false
  try {
    const u = new URL(m[1])
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

function argsHaveUrl(args: string[]): boolean {
  return args.some((a) => looksLikeUrl(a))
}

function rmArgsIncludeForceOption(args: string[]): boolean {
  return args
    .slice(0, args.indexOf('--') === -1 ? args.length : args.indexOf('--'))
    .some((arg) => arg === '--force' || /^-[^-]/.test(arg) && arg.slice(1).includes('f'))
}

/** Port of the `sh -c <script>` literal recursion: tokenize the script text. */
function shLiteralCommands(script: string): string[][] | null {
  return splitInvocationSegments(script)
}

export interface DangerousOptions {
  platform?: DangerousPlatform
  wrapperDepth?: number
}

/** Core classifier over an already-tokenized invocation. */
export function dangerousCommandMatch(
  command: string[],
  options: DangerousOptions = {},
): DangerousMatch | null {
  const platform = options.platform ?? (process.platform === 'win32' ? 'windows' : 'posix')
  return matchWithDepth(command, options.wrapperDepth ?? 0, platform)
}

/**
 * Semantic-line classifier: parses the raw command line (quotes, control
 * operators, command substitutions, heredocs) and classifies every embedded
 * invocation — catching `echo $(rm -rf /)`-style evasion that naive
 * tokenizers miss.
 */
export function dangerousCommandMatchLine(
  line: string,
  options: DangerousOptions = {},
): DangerousMatch | null {
  const platform = options.platform ?? (process.platform === 'win32' ? 'windows' : 'posix')
  for (const sub of shellSubCommands(line)) {
    const words = shlexSplit(sub)
    if (!words?.length) continue
    const m = matchWithDepth(words, options.wrapperDepth ?? 0, platform)
    if (m) return m
  }
  return null
}

function matchWithDepth(
  command: string[],
  wrapperDepth: number,
  platform: DangerousPlatform,
): DangerousMatch | null {
  if (wrapperDepth > MAX_WRAPPER_DEPTH) return 'Other'

  const execMatch = matchForExec(command, wrapperDepth, platform)
  if (execMatch) return execMatch

  // Literal shell scripts: any nested literal command might be dangerous.
  if (command.length >= 3 && executableNameLookupKey(command[0], 'posix') &&
      ['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(executableNameLookupKey(command[0], 'posix')!)) {
    const flagIdx = command.findIndex((t, i) => i > 0 && (t === '-c' || t === '-lc' || t === '--command'))
    if (flagIdx > 0 && typeof command[flagIdx + 1] === 'string') {
      const nested = shLiteralCommands(command[flagIdx + 1])
      if (nested) {
        for (const invocation of nested) {
          const m = matchWithDepth(invocation, wrapperDepth + 1, platform)
          if (m) return m
        }
      }
    }
  }

  if (platform === 'windows' && isDangerousCommandWindows(command)) return 'Other'
  return null
}

function matchForExec(
  command: string[],
  wrapperDepth: number,
  platform: DangerousPlatform,
): DangerousMatch | null {
  // Privilege-escalation wrappers: route the inner command back through the
  // classifier (shell_detect escalation routing). `sudo` was handled inline
  // before; this generalizes to doas/pkexec/su -c (posix) and
  // runas/gsudo/elevate (windows).
  const esc = detectEscalation(command, platform)
  if (esc) return matchWithDepth(esc.rest, wrapperDepth + 1, platform)

  const key = command.length ? executableNameLookupKey(command[0], platform) : null
  if (key === 'rm' && rmArgsIncludeForceOption(command.slice(1))) return 'ForcedRm'
  if (key === 'env') return matchForEnv(command, wrapperDepth, platform)
  if (key === 'trap') return matchForTrap(command, wrapperDepth, platform)
  return null
}

/**
 * Skip an escalator's own leading options so they don't shadow the inner command.
 * POSIX escalators use `-`-prefixed options; a single-letter `-X` may consume the
 * following token as its argument (e.g. `sudo -u root …`). `runas` uses `/`-prefixed
 * self-contained options (e.g. `/user:Admin`).
 */
function skipLeadingOptions(args: string[], platform: DangerousPlatform): string[] {
  const isOpt = (t: string) => (platform === 'windows' ? /^[-/]/.test(t) : t.startsWith('-'))
  let i = 0
  while (i < args.length && isOpt(args[i])) {
    i++
    if (platform !== 'windows' && /^-[a-zA-Z]$/.test(args[i - 1] ?? '')) {
      if (i < args.length) i++ // single-letter option consumes its argument
    }
  }
  return args.slice(i)
}

export interface Escalation {
  escalator: string
  rest: string[]
}

/**
 * Detect a privilege-escalation wrapper and return the inner command to classify.
 * Closes the "shell_detect escalation routing" gap. Returns null when the command
 * is not an escalator (or `su` invoked without `-c`). PowerShell `-Verb RunAs`
 * inside a quoted script is intentionally NOT handled here — the PS parser is
 * best-effort (see file header) and the verb lives inside the script token.
 */
export function detectEscalation(command: string[], platform: DangerousPlatform): Escalation | null {
  if (!command.length) return null
  const key = executableNameLookupKey(command[0], platform)
  if (!key) return null

  if (key === 'sudo' || key === 'doas' || key === 'pkexec' || key === 'gsudo' || key === 'elevate') {
    return { escalator: key, rest: skipLeadingOptions(command.slice(1), 'posix') }
  }
  if (key === 'runas') {
    return { escalator: 'runas', rest: skipLeadingOptions(command.slice(1), 'windows') }
  }
  if (key === 'su') {
    const cIdx = command.findIndex((t, i) => i > 0 && (t === '-c' || t === '--command'))
    if (cIdx > 0 && typeof command[cIdx + 1] === 'string') {
      return { escalator: 'su', rest: ['sh', '-c', command[cIdx + 1]] }
    }
  }
  return null
}

function matchForEnv(command: string[], wrapperDepth: number, platform: DangerousPlatform): DangerousMatch | null {
  let i = 1
  while (i < command.length) {
    const arg = command[i]
    if (arg === '--') { i++; break }
    if (arg === '-i' || arg === '--ignore-environment' || /^[^-]+=/.test(arg)) { i++; continue }
    break
  }
  return matchWithDepth(command.slice(i), wrapperDepth + 1, platform)
}

function matchForTrap(command: string[], wrapperDepth: number, platform: DangerousPlatform): DangerousMatch | null {
  let actionIndex = 1
  if (command[actionIndex] === '--') actionIndex++
  const action = command[actionIndex]
  if (action === undefined || action.startsWith('-')) return null
  return matchWithDepth(['sh', '-c', action], wrapperDepth + 1, platform)
}

// ── windows patterns (windows_dangerous_commands.rs) ─────────────────────────

export function isDangerousCommandWindows(command: string[]): boolean {
  if (isDangerousPowershell(command)) return true
  if (isDangerousCmd(command)) return true
  return isDirectGuiLaunch(command)
}

function isPowershellInvocationArgs(args: string[]): string[] | null {
  if (!args.length) return null
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    const lower = arg.toLowerCase()
    if (lower === '-command' || lower === '/command' || lower === '-c') {
      const script = args[idx + 1]
      if (script === undefined) return null
      if (idx + 2 !== args.length) return null
      return shlexSplit(script)
    }
    if (lower.startsWith('-command:') || lower.startsWith('/command:')) {
      if (idx + 1 !== args.length) return null
      return shlexSplit(arg.slice(arg.indexOf(':') + 1))
    }
    if (['-nologo', '-noprofile', '-noninteractive', '-mta', '-sta'].includes(lower) || lower.startsWith('-')) {
      idx++
      continue
    }
    return args.slice(idx)
  }
  return null
}

function isDangerousPowershell(command: string[]): boolean {
  if (!command.length) return false
  if (!isPowershellExecutable(command[0])) return false
  const tokens = isPowershellInvocationArgs(command.slice(1))
  if (!tokens) return false
  return isDangerousPowershellWords(tokens)
}

export function isDangerousPowershellWords(words: string[]): boolean {
  const tokensLc = words.map((t) => t.replace(/^'+|^"+/g, '').replace(/'+$|"+$/g, '').toLowerCase())
  const hasUrl = argsHaveUrl(words)

  if (hasUrl && tokensLc.some((t) =>
    ['start-process', 'start', 'saps', 'invoke-item', 'ii'].includes(t)
    || t.includes('start-process') || t.includes('invoke-item'))) return true

  if (hasUrl && tokensLc.some((t) => t.includes('shellexecute') || t.includes('shell.application'))) return true

  const first = tokensLc[0]
  if (first) {
    if (first === 'rundll32' && tokensLc.some((t) => t.includes('url.dll,fileprotocolhandler')) && hasUrl) return true
    if (first === 'mshta' && hasUrl) return true
    if (isBrowserExecutable(first) && hasUrl) return true
    if (first === 'explorer' || first === 'explorer.exe') { if (hasUrl) return true }
  }

  return hasForceDeleteCmdlet(tokensLc)
}

function isDangerousCmd(command: string[]): boolean {
  if (!command.length) return false
  const base = executableBasename(command[0])
  if (base !== 'cmd' && base !== 'cmd.exe') return false

  let i = 1
  for (; i < command.length; i++) {
    const lower = command[i].toLowerCase()
    if (lower === '/c' || lower === '/r' || lower === '-c') { i++; break }
    if (lower.startsWith('/')) continue
    return false
  }
  const remaining = command.slice(i)
  if (!remaining.length) return false

  const cmdTokens = remaining.length === 1 ? (shlexSplit(remaining[0]) ?? [remaining[0]]) : remaining
  const tokens = cmdTokens.flatMap(splitEmbeddedCmdOperators)

  const CMD_SEPARATORS = ['&', '&&', '|', '||']
  const segments: string[][] = [[]]
  for (const t of tokens) {
    if (CMD_SEPARATORS.includes(t)) segments.push([])
    else segments[segments.length - 1].push(t)
  }
  return segments.some((segment) => {
    const cmd = segment[0]
    if (cmd === undefined) return false
    if (cmd.toLowerCase() === 'start' && argsHaveUrl(segment)) return true
    if ((cmd.toLowerCase() === 'del' || cmd.toLowerCase() === 'erase') && hasForceFlagCmd(segment)) return true
    if ((cmd.toLowerCase() === 'rd' || cmd.toLowerCase() === 'rmdir')
      && hasRecursiveFlagCmd(segment) && hasQuietFlagCmd(segment)) return true
    return false
  })
}

function isDirectGuiLaunch(command: string[]): boolean {
  if (!command.length) return false
  const base = executableBasename(command[0])
  if (!base) return false
  const rest = command.slice(1)
  if ((base === 'explorer' || base === 'explorer.exe') && argsHaveUrl(rest)) return true
  if ((base === 'mshta' || base === 'mshta.exe') && argsHaveUrl(rest)) return true
  if ((base === 'rundll32' || base === 'rundll32.exe')
    && rest.some((t) => t.toLowerCase().includes('url.dll,fileprotocolhandler'))
    && argsHaveUrl(rest)) return true
  if (isBrowserExecutable(base) && argsHaveUrl(rest)) return true
  return false
}

function splitEmbeddedCmdOperators(token: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch === '&' || ch === '|') {
      if (i > start) parts.push(token.slice(start, i))
      const opLen = token[i + 1] === ch ? 2 : 1
      parts.push(token.slice(i, i + opLen))
      i += opLen - 1
      start = i + 1
    }
  }
  if (start < token.length) parts.push(token.slice(start))
  return parts.filter((s) => s.trim() !== '')
}

function hasForceDeleteCmdlet(tokens: string[]): boolean {
  const segments: string[][] = [[]]
  for (const tok of tokens) {
    let cur = ''
    for (const ch of tok) {
      if (SEG_SEPS.includes(ch)) {
        const s = cur.trim()
        const last = segments[segments.length - 1]
        if (s) last.push(s)
        cur = ''
        if (segments[segments.length - 1].length) segments.push([])
      } else cur += ch
    }
    const s = cur.trim()
    if (s) segments[segments.length - 1].push(s)
  }
  return segments.some((seg) => {
    const atoms = seg.flatMap((t) => t.split(new RegExp(`[${SOFT_SEPS.map(escapeRe).join('')}]`))).map((s) => s.trim()).filter(Boolean)
    let hasDelete = false
    let hasForce = false
    for (const a of atoms) {
      if (DELETE_CMDLETS.includes(a.toLowerCase())) hasDelete = true
      if (a.toLowerCase() === '-force' || a.toLowerCase().startsWith('-force:')) hasForce = true
    }
    return hasDelete && hasForce
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hasForceFlagCmd(args: string[]): boolean { return args.some((a) => a.toLowerCase() === '/f') }
function hasRecursiveFlagCmd(args: string[]): boolean { return args.some((a) => a.toLowerCase() === '/s') }
function hasQuietFlagCmd(args: string[]): boolean { return args.some((a) => a.toLowerCase() === '/q') }
