#!/usr/bin/env node
// Consistency check: coverage.yaml (human source of truth) vs coverage.json
// (machine mirror read by dsh-codex-pack loadLedger + verify_coverage.py).
//
// The ledger has TWO artifacts with no generator between them — this script is
// the guard that keeps them semantically identical. Per entry it compares:
//   dest, code, status, lines, audit, note
// and reports YAML-ONLY / JSON-ONLY path-set drift. Exit 1 on any difference.
//
// Usage: node scripts/check_yaml_json_consistency.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function unquote(v) {
  const t = v.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t) } catch { return t.slice(1, -1) }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1)
  return t
}

/**
 * Tolerant parser for the ledger's stable entry shape:
 *   - 2-space `  - path: <v>` starts an entry
 *   - 4-space `key: value` fields (blank lines between fields are legal)
 *   - `#` comments and the top-level meta: block are ignored
 */
export function parseYamlEntries(text) {
  const entries = []
  let cur = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue
    const entryM = /^ {2}- path:\s*(.*)$/.exec(line)
    if (entryM) {
      cur = { path: unquote(entryM[1]) }
      entries.push(cur)
      continue
    }
    const fieldM = /^ {4}([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (fieldM && cur) {
      const [, k, v] = fieldM
      if (k === 'path') continue
      cur[k] = k === 'lines' ? Number(v) : unquote(v)
    }
  }
  return entries
}

const SEMANTIC = ['dest', 'code', 'status', 'lines', 'audit', 'note']

const FIX = process.argv.includes('--fix')
const yamlRaw = readFileSync(join(root, 'coverage.yaml'), 'utf8')
let yamlOut = yamlRaw // mutable working copy for the --fix pass
const yamlEntries = parseYamlEntries(yamlRaw)
const json = JSON.parse(readFileSync(join(root, 'coverage.json'), 'utf8'))
const jsonByPath = new Map(json.entries.map((e) => [e.path, e]))

const problems = []
let compared = 0

for (const y of yamlEntries) {
  const j = jsonByPath.get(y.path)
  if (!j) {
    problems.push(['YAML-ONLY', y.path, 'missing in coverage.json'])
    continue
  }
  compared++
  for (const k of SEMANTIC) {
    const yv = y[k] ?? ''
    const jv = j[k] ?? ''
    if (String(yv) !== String(jv)) {
      problems.push(['DRIFT', y.path, `${k}: yaml=${JSON.stringify(String(yv).slice(0, 80))} json=${JSON.stringify(String(jv).slice(0, 80))}`])
    }
  }
  jsonByPath.delete(y.path)
}
for (const [p] of jsonByPath) problems.push(['JSON-ONLY', p, 'missing in coverage.yaml'])

console.log(`yaml entries: ${yamlEntries.length} · json entries: ${json.entries.length} · compared: ${compared}`)

if (FIX && problems.length) {
  let yamlFixed = 0
  let jsonFixed = 0
  const byPath = new Map(yamlEntries.map((e) => [e.path, e]))
  for (const [t, p, d] of problems) {
    if (t === 'DRIFT' && d.startsWith('dest: yaml=""')) {
      // Backport dest from json into yaml (json is complete here; rollup needs it).
      const dest = jsonByPathRestore(json, p)
      if (!dest) continue
      // Insert right after the entry's lines: line (or header line when absent).
      const lines = yamlOut.split('\n')
      const start = lines.findIndex((l) => /^ {2}- path:/.test(l) && unquote(l.replace(/^ {2}- path:\s*/, '')) === p)
      if (start === -1) continue
      let insertAt = start + 1
      for (let i = start + 1; i < lines.length; i++) {
        if (/^ {2}- path:/.test(lines[i])) break
        if (/^ {4}lines:/.test(lines[i])) { insertAt = i + 1; break }
        if (/^ {4}[a-z_]+:/.test(lines[i])) { insertAt = i; break }
      }
      lines.splice(insertAt, 0, `    dest: ${dest}`)
      yamlRawSet(lines.join('\n'))
      byPath.get(p).dest = dest
      yamlFixed++
    } else if (t === 'DRIFT') {
      const k = d.split(':')[0]
      const y = byPath.get(p)
      const j = json.entries.find((e) => e.path === p)
      if (!y || !j) continue
      if (y[k] === undefined || y[k] === '') delete j[k]
      else j[k] = y[k]
      jsonFixed++
    }
  }
  // Mirror bookkeeping: record when the machine mirror was re-audited.
  json.meta.status_audit_at = '2026-09-07'
  writeBack()
  console.log(`fix pass: yaml dest backported ×${yamlFixed}, json fields synced ×${jsonFixed}, meta.status_audit_at → 2026-09-07`)
  process.exit(2) // caller must re-run without --fix to confirm
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
void escapeRe
function jsonByPathRestore(json, p) { return json.entries.find((e) => e.path === p)?.dest }

if (problems.length) {
  console.log(`INCONSISTENT: ${problems.length} problem(s)`)
  for (const [t, p, d] of problems) console.log(`  [${t}] ${p} — ${d}`)
  process.exit(1)
}
console.log('[OK] coverage.yaml and coverage.json are semantically consistent')

// -- yaml write-back plumbing --
function yamlRawSet(v) { yamlOut = v }
function writeBack() {
  const trailing = readFileSync(join(root, 'coverage.json'), 'utf8').endsWith('\n')
  writeFileSync(join(root, 'coverage.yaml'), yamlOut)
  writeFileSync(join(root, 'coverage.json'), JSON.stringify(json, null, 2) + (trailing ? '\n' : ''))
}
