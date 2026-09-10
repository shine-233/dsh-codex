// Port of openai/codex core/src/command_canonicalization.rs (Apache-2.0,
// anchor rust-v0.153.4): canonicalize command argv for approval-cache matching.
//
// Keeps approval decisions stable across wrapper-path differences
// (`/bin/bash -lc` vs `bash -lc`) and across shell wrapper tools, while
// preserving exact script text for complex scripts where a tokenized command
// sequence cannot be safely recovered.
//
// Simplification vs upstream: the "plain commands" test is a conservative
// word-only check (no quotes, substitutions, redirects, globs, or operators
// beyond && || ; |) instead of upstream's tree-sitter grammar walk.
import {
  extractPowershellCommand,
  parsePowershellScriptIntoPlainCommands,
} from './powershellLowering.js'

const SH_SCRIPT_PREFIX = '__codex_shell_script__'
const PS_SCRIPT_PREFIX = '__codex_powershell_script__'

const SHELL_BASENAMES = new Set(['sh', 'bash', 'zsh'])

function basename(raw: string): string {
  const name = raw.split(/[\\/]/).pop() ?? ''
  return name.replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase()
}

/** `[shell, -c|-lc, script]` with a bash/sh/zsh shell? */
export function extractBashCommand(argv: string[]): { shellMode: string; script: string } | null {
  if (argv.length !== 3) return null
  const [shell, flag, script] = argv
  if (flag !== '-lc' && flag !== '-c') return null
  if (!SHELL_BASENAMES.has(basename(shell))) return null
  return { shellMode: flag, script }
}

/** `[powershell|pwsh, supported flags..., -Command|-c, script]`? */
export function extractPowershellCommandForApproval(argv: string[]): { script: string } | null {
  const extracted = extractPowershellCommand(argv)
  return extracted ? { script: extracted.script } : null
}

/** Word-only token: no shell metacharacters that could hide another command. */
function isPlainWordToken(token: string): boolean {
  return !/['"`$<>&;|*?~(){}\n\r]/.test(token) && !/^\s*#/.test(token)
}

/**
 * Script that only contains word-only commands joined by safe operators?
 * Returns the tokenized command list, or null when anything dynamic appears.
 */
export function parsePlainCommandScript(script: string): string[][] | null {
  const segments = script.split(/\r?\n|\|\||&&|\||;/).map((s) => s.trim()).filter(Boolean)
  if (!segments.length) return null
  const commands: string[][] = []
  for (const seg of segments) {
    const words = seg.split(/\s+/)
    if (!words.every(isPlainWordToken) || words.length === 0) return null
    commands.push(words)
  }
  return commands
}

export function canonicalizeCommandForApproval(argv: string[]): string[] {
  // sh/bash/zsh -c|-lc <script>: unwrap single plain commands.
  if (extractBashCommand(argv)) {
    const script = argv[2]
    const commands = parsePlainCommandScript(script)
    if (commands && commands.length === 1) return commands[0]
    return [SH_SCRIPT_PREFIX, argv[1], script]
  }
  const powershell = extractPowershellCommand(argv)
  if (powershell) {
    const commands = parsePowershellScriptIntoPlainCommands(powershell.script)
    if (commands && commands.length === 1) return commands[0]
    return [PS_SCRIPT_PREFIX, powershell.script]
  }
  return argv
}
