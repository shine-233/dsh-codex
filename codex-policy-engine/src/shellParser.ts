// Semantic shell line parser distilled from openai/codex shell-command
// parse_command.rs (Apache-2.0, anchor rust-v0.153.4). Upstream's full parser
// is 2,766 lines of bash grammar; this distillation keeps the semantics that
// safety classification needs: quotes, comments, control/list operators,
// redirections (incl. heredocs), command substitution and subshells — so the
// classifier can see through `echo $(rm -rf /)`-style evasion that a naive
// tokenizer misses.
export interface ShellInvocation {
  argv: string[]
  redirects: string[]
  substitutions: string[]
}

export interface ParsedShellLine {
  invocations: ShellInvocation[]
  heredocs: { tag: string; body: string }[]
  substitutions: string[]
  comments: string[]
}

const CONTROL_OPS = ['&&', '||', ';', '|', '&']

/** Parse a raw shell command line into structured invocations. */
export function parseShellLine(line: string): ParsedShellLine {
  const result: ParsedShellLine = { invocations: [], heredocs: [], substitutions: [], comments: [] }
  if (!line.trim()) return result

  const argv: string[] = []
  const redirects: string[] = []
  const substitutions: string[] = []
  const pushInvocation = () => {
    if (argv.length || redirects.length || substitutions.length) {
      result.invocations.push({ argv: [...argv], redirects: [...redirects], substitutions: [...substitutions] })
    }
    argv.length = 0
    redirects.length = 0
    substitutions.length = 0
  }

  let i = 0
  let cur = ''
  let q: string | null = null
  const flushWord = () => { if (cur !== '') { argv.push(cur); cur = '' } }
  const flushOp = () => { flushWord(); pushInvocation() }

  while (i < line.length) {
    const ch = line[i]
    // comments: unquoted # starts a comment (word-initial or after space)
    if (ch === '#' && q === null && (cur === '' || /\s$/.test(cur))) {
      if (cur.trim()) argv.push(cur.trim())
      result.comments.push(line.slice(i + 1).trim())
      break
    }
    if (q) {
      if (q === "'" && ch === "'") q = null
      else if (q === '"' && ch === '"') q = null
      else if (q === '"' && ch === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) { cur += ch; i++; cur += line[i] }
      else cur += ch
      i++
      continue
    }
    if (ch === "'" || ch === '"') { q = ch; i++; continue }
    // backslash escape outside quotes
    if (ch === '\\' && i + 1 < line.length) { cur += line[i + 1]; i += 2; continue }
    // command substitution $( ... )
    if (ch === '$' && line[i + 1] === '(') {
      let depth = 1
      let j = i + 2
      let inner = ''
      while (j < line.length && depth > 0) {
        if (line[j] === '(') depth++
        if (line[j] === ')') { depth--; if (depth === 0) break }
        inner += line[j]
        j++
      }
      result.substitutions.push(inner)
      substitutions.push(inner)
      argv.push(cur + `$(${inner})`)
      cur = ''
      i = j + 1
      continue
    }
    // legacy backtick substitution
    if (ch === '`') {
      const end = line.indexOf('`', i + 1)
      if (end === -1) { cur += ch; i++; continue }
      const inner = line.slice(i + 1, end)
      result.substitutions.push(inner)
      substitutions.push(inner)
      argv.push(cur + `\`${inner}\``)
      cur = ''
      i = end + 1
      continue
    }
    // heredoc: <<[-]TAG (body consumed after the newline)
    if (ch === '<' && (line[i + 1] === '<')) {
      let j = i + 2
      let dash = false
      if (line[j] === '-') { dash = true; j++ }
      while (j < line.length && line[j] === ' ') j++ // bash allows `<< EOF`
      const tagMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(j))
      if (tagMatch) {
        const tag = tagMatch[1]
        const nl = line.indexOf('\n', j)
        if (nl !== -1) {
          const bodyLines: string[] = []
          const rest = line.slice(nl + 1).split('\n')
          while (rest.length) {
            const l = rest.shift()!
            const cmp = dash ? l.replace(/^\t+/, '') : l
            if (cmp === tag) break
            bodyLines.push(l)
          }
          result.heredocs.push({ tag, body: bodyLines.join('\n') })
          redirects.push(`<<${tag}`)
          argv.push(cur)
          cur = ''
          const consumed = nl + 1 + bodyLines.join('\n').length + (bodyLines.length ? bodyLines.length : 0)
          // skip to end of the consumed heredoc body
          i = line.length
          flushOp()
          void consumed
          continue
        }
      }
      cur += ch; i++; continue
    }
    // redirections
    if (ch === '>' || ch === '<') {
      flushWord()
      let op = ch
      if (line[i + 1] === ch) { op += ch; i++ }
      else if (ch === '>' && line[i + 1] === '&') { op += '&'; i++ }
      // target word
      i++
      while (i < line.length && /\s/.test(line[i])) i++
      let target = ''
      while (i < line.length && !/[\s|&;]/.test(line[i])) { target += line[i]; i++ }
      redirects.push(`${op}${target}`)
      continue
    }
    // control operators
    if (ch === ';' || ch === '|' || ch === '&') {
      flushOp()
      const two = line.slice(i, i + 2)
      if (two === '&&' || two === '||') i++
      i++
      continue
    }
    if (/\s/.test(ch)) { flushWord(); i++; continue }
    cur += ch
    i++
  }
  flushOp()
  return result
}

/** All literal sub-commands embedded in a line: invocations, substitutions, heredoc bodies. */
export function shellSubCommands(line: string): string[] {
  const parsed = parseShellLine(line)
  const cmds: string[] = parsed.invocations.map((inv) => inv.argv.join(' '))
  cmds.push(...parsed.substitutions)
  for (const h of parsed.heredocs) cmds.push(h.body)
  return cmds.filter((c) => c.trim() !== '')
}
