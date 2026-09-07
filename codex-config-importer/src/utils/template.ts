// Port of openai/codex utils/template (Apache-2.0, rust-v0.153.4):
// `{{ name }}` placeholder templates with parse-time validation.
export class TemplateParseError extends Error {}
export class TemplateRenderError extends Error {}

export interface ParsedTemplate {
  /** Ordered unique placeholder names. */
  placeholders: string[]
  /** Render to text; `parts` alternate literal / placeholder. */
  parts: ({ kind: 'literal'; text: string } | { kind: 'placeholder'; name: string })[]
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

export function parse(source: string): ParsedTemplate {
  const placeholders: string[] = []
  const parts: ParsedTemplate['parts'] = []
  let cursor = 0
  for (const m of source.matchAll(PLACEHOLDER)) {
    if (m.index! > cursor) parts.push({ kind: 'literal', text: source.slice(cursor, m.index) })
    const name = m[1]
    parts.push({ kind: 'placeholder', name })
    if (!placeholders.includes(name)) placeholders.push(name)
    cursor = m.index! + m[0].length
  }
  if (cursor < source.length) parts.push({ kind: 'literal', text: source.slice(cursor) })
  return { placeholders, parts }
}

export function render(tpl: ParsedTemplate, variables: Record<string, string>): string {
  return tpl.parts.map((part) => {
    if (part.kind === 'literal') return part.text
    const v = variables[part.name]
    if (v === undefined) throw new TemplateRenderError(`missing variable: ${part.name}`)
    return v
  }).join('')
}

export function renderTemplate(source: string, variables: Record<string, string>): string {
  return render(parse(source), variables)
}
