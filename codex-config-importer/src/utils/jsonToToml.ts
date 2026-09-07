// Port of openai/codex utils/json-to-toml (Apache-2.0, rust-v0.153.4):
// JSON value → TOML value conversion. Nulls become empty strings (TOML has no
// null); arrays of tables become [[array-of-table]] blocks on serialization.
export type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue }

export function jsonToToml(v: unknown): TomlValue {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isInteger(v) ? v : v
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(jsonToToml)
  if (typeof v === 'object') {
    const out: Record<string, TomlValue> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = jsonToToml(val)
    return out
  }
  return String(v)
}

const quoteKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k))
const quoteValue = (v: TomlValue): string => {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  throw new Error('inline value must be scalar')
}

/** Serialize a converted TOML value to text (tables + arrays of tables). */
export function toTomlString(value: TomlValue, out: string[] = [], prefix = ''): string {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      out.push(`${prefix ? prefix + ' = ' : ''}[${value.map((v) => quoteValue(v as TomlValue)).join(', ')}]`)
      return out.join('\n')
    }
    for (const item of value) {
      out.push(`${prefix ? `[[${prefix}]]` : '[]'}`)
      toTomlTable(item as Record<string, TomlValue>, out, prefix)
    }
    return out.join('\n')
  }
  toTomlTable(value as Record<string, TomlValue>, out, prefix)
  return out.join('\n')
}

function toTomlTable(table: Record<string, TomlValue>, out: string[], prefix: string): void {
  const subTables: [string, Exclude<TomlValue, string | number | boolean>][] = []
  for (const [k, v] of Object.entries(table)) {
    if (v !== null && typeof v === 'object') subTables.push([k, v as Exclude<TomlValue, string | number | boolean>])
    else out.push(`${quoteKey(k)} = ${quoteValue(v as TomlValue)}`)
  }
  for (const [k, v] of subTables) {
    const full = prefix ? `${prefix}.${quoteKey(k)}` : quoteKey(k)
    if (Array.isArray(v)) toTomlString(v, out, full)
    else {
      out.push(`[${full}]`)
      toTomlTable(v, out, full)
    }
  }
}
