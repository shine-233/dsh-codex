// Conservative literal PowerShell lowering aligned with openai/codex
// shell-command/src/command_safety/powershell_tree_sitter.rs. This does not run
// PowerShell or classify safety: unknown and dynamic syntax fail closed.

const POWERSHELL_FLAGS = new Set(['-nologo', '-noprofile', '-command', '-c'])
const UNICODE_SYNTAX_ALIASES = /[‘’“”–—―]/u
const STRUCTURAL_BARE = /[$@'"(){}\[\];|&><,]/u
const TOKEN_BOUNDARY = /\s/u

function executableBasename(value: string): string {
  return (value.split(/[\\/]/u).pop() ?? '').replace(/\.exe$/iu, '').toLowerCase()
}

export function extractPowershellCommand(
  command: readonly string[],
): { shell: string; script: string } | null {
  if (command.length < 3) return null
  const shell = command[0]
  const basename = executableBasename(shell)
  if (basename !== 'powershell' && basename !== 'pwsh') return null

  for (let index = 1; index + 1 < command.length; index += 1) {
    const flag = command[index].toLowerCase()
    if (!POWERSHELL_FLAGS.has(flag)) return null
    if (flag === '-command' || flag === '-c') {
      return index + 2 === command.length
        ? { shell, script: command[index + 1] }
        : null
    }
  }
  return null
}

type Word = { value: string; bare: boolean }
type Cursor = { index: number }

function decodeBacktickEscape(value: string): string {
  const escapes: Record<string, string> = {
    '0': '\0',
    a: '',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '',
  }
  return escapes[value] ?? value
}

function readSingleQuoted(script: string, cursor: Cursor): Word | null {
  let value = ''
  cursor.index += 1
  while (cursor.index < script.length) {
    if (script[cursor.index] !== "'") {
      value += script[cursor.index]
      cursor.index += 1
      continue
    }
    if (script[cursor.index + 1] === "'") {
      value += "'"
      cursor.index += 2
      continue
    }
    cursor.index += 1
    return { value, bare: false }
  }
  return null
}

function readDoubleQuoted(script: string, cursor: Cursor): Word | null {
  let value = ''
  cursor.index += 1
  while (cursor.index < script.length) {
    const char = script[cursor.index]
    if (char === '"') {
      cursor.index += 1
      return { value, bare: false }
    }
    if (char === '$') return null
    if (char === '`') {
      const escaped = script[cursor.index + 1]
      if (escaped === undefined || escaped === 'e') return null
      if (escaped === 'u' && script[cursor.index + 2] === '{') return null
      value += decodeBacktickEscape(escaped)
      cursor.index += 2
      continue
    }
    value += char
    cursor.index += 1
  }
  return null
}

function readBare(script: string, cursor: Cursor): Word | null {
  let value = ''
  while (cursor.index < script.length) {
    const char = script[cursor.index]
    if (TOKEN_BOUNDARY.test(char) || ';|&'.includes(char)) break
    if (char === '#' && value.length === 0) break
    if (char === '`') {
      const escaped = script[cursor.index + 1]
      if (escaped === undefined || escaped === 'e') return null
      value += decodeBacktickEscape(escaped)
      cursor.index += 2
      continue
    }
    if (STRUCTURAL_BARE.test(char)) return null
    value += char
    cursor.index += 1
  }
  return value ? { value, bare: true } : null
}

function readWord(script: string, cursor: Cursor): Word | null {
  if (script[cursor.index] === "'") return readSingleQuoted(script, cursor)
  if (script[cursor.index] === '"') return readDoubleQuoted(script, cursor)
  return readBare(script, cursor)
}

function bareWordIsLiteral(word: string): boolean {
  if (word.includes('#') && word.endsWith('#')) return false
  if (word === '--%') return false
  if (word.startsWith('-') && !word.startsWith('--') && (word.includes(':') || word.includes('='))) return false
  if (/^\d/u.test(word)) {
    return word === '0' || /^[1-9]\d*$/u.test(word)
  }
  return true
}

function skipLineComment(script: string, cursor: Cursor): void {
  while (cursor.index < script.length && !/[\r\n]/u.test(script[cursor.index])) {
    cursor.index += 1
  }
}

function skipBlockComment(script: string, cursor: Cursor): boolean {
  const end = script.indexOf('#>', cursor.index + 2)
  if (end < 0) return false
  cursor.index = end + 2
  return true
}

function consumeSeparator(script: string, cursor: Cursor): boolean | null {
  const char = script[cursor.index]
  if (char === ';' || char === '\r' || char === '\n') {
    cursor.index += 1
    if (char === '\r' && script[cursor.index] === '\n') cursor.index += 1
    return true
  }
  if (char === '|') {
    cursor.index += script[cursor.index + 1] === '|' ? 2 : 1
    return true
  }
  if (char === '&' && script[cursor.index + 1] === '&') {
    cursor.index += 2
    return true
  }
  return null
}

export function parsePowershellScriptIntoPlainCommands(
  script: string,
): string[][] | null {
  if (!script.trim() || UNICODE_SYNTAX_ALIASES.test(script)) return null
  const cursor: Cursor = { index: 0 }
  const commands: string[][] = []
  let current: string[] = []
  let needsCommand = true

  while (cursor.index < script.length) {
    while (cursor.index < script.length && TOKEN_BOUNDARY.test(script[cursor.index])) {
      cursor.index += 1
    }
    if (cursor.index >= script.length) break

    if (script.startsWith('<#', cursor.index)) {
      if (current.length || !skipBlockComment(script, cursor)) return null
      continue
    }
    if (script[cursor.index] === '#') {
      if (!current.length && needsCommand) return null
      skipLineComment(script, cursor)
      continue
    }

    const separator = consumeSeparator(script, cursor)
    if (separator !== null) {
      if (!current.length) return null
      commands.push(current)
      current = []
      needsCommand = true
      continue
    }

    const word = readWord(script, cursor)
    if (!word || !word.value || (word.bare && !bareWordIsLiteral(word.value))) return null
    if (cursor.index < script.length) {
      const next = script[cursor.index]
      if (!TOKEN_BOUNDARY.test(next) && !';|&'.includes(next) && next !== '#') return null
    }
    current.push(word.value)
    needsCommand = false
  }

  if (current.length) commands.push(current)
  if (!commands.length || needsCommand) return null
  if (commands.some(command => command[0].toLowerCase() === 'using')) return null
  return commands
}

export function parsePowershellCommandIntoPlainCommands(
  command: readonly string[],
): string[][] | null {
  const extracted = extractPowershellCommand(command)
  return extracted
    ? parsePowershellScriptIntoPlainCommands(extracted.script)
    : null
}
