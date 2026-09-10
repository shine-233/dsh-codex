#!/usr/bin/env node
// Consistency check: coverage.yaml (human source of truth) vs coverage.json
// (machine mirror read by dsh-codex-pack loadLedger + verify_coverage.py).
//
// The ledger has TWO artifacts with no generator between them — this script is
// the guard that keeps them semantically identical. It compares selected meta
// provenance fields plus, per entry:
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

export function parseYamlMeta(text) {
  const meta = {}
  let currentReview = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (/^entries:/.test(line)) break
    const fieldM = /^ {2}([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (fieldM && fieldM[1] !== 'incremental_reviews') {
      meta[fieldM[1]] = unquote(fieldM[2])
      continue
    }
    const reviewM = /^ {4}- range:\s*(.*)$/.exec(line)
    if (reviewM) {
      currentReview = { range: unquote(reviewM[1]) }
      ;(meta.incremental_reviews ??= []).push(currentReview)
      continue
    }
    const reviewFieldM = /^ {6}([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (reviewFieldM && currentReview) {
      const [, key, value] = reviewFieldM
      currentReview[key] = key === 'non_merge_commits'
        ? Number(value)
        : unquote(value)
    }
  }
  return meta
}

const SEMANTIC = ['dest', 'code', 'status', 'lines', 'audit', 'note']
const META_SEMANTIC = [
  'upstream',
  'anchor_commit',
  'generated_at',
  'status_audit_at',
  'incremental_reviews',
]
const EVIDENCE_CLASSES = new Set([
  'runtime-equivalent',
  'behavioral-subset',
  'structural-only',
  'implemented-unconsumed',
  'unsupported-overclaim',
])
const EXCLUSION_DISPOSITIONS = new Set([
  'split',
  'blocked',
  'excluded',
  'migration-candidate',
])

const FIX = process.argv.includes('--fix')
const yamlRaw = readFileSync(join(root, 'coverage.yaml'), 'utf8')
let yamlOut = yamlRaw // mutable working copy for the --fix pass
const yamlEntries = parseYamlEntries(yamlRaw)
const yamlMeta = parseYamlMeta(yamlRaw)
const json = JSON.parse(readFileSync(join(root, 'coverage.json'), 'utf8'))
const evidence = JSON.parse(readFileSync(join(root, 'evidence-review.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(root, 'inventory-provenance.json'), 'utf8'))
const jsonByPath = new Map(json.entries.map((e) => [e.path, e]))

const problems = []
let compared = 0

const positivePaths = json.entries.filter((entry) => entry.status).map((entry) => entry.path)
const evidencePaths = Object.keys(evidence.positiveEntries)
for (const path of positivePaths) {
  const evidenceClass = evidence.positiveEntries[path]
  if (!evidenceClass) problems.push(['EVIDENCE-MISSING', path, 'positive row has no evidence class'])
  else if (!EVIDENCE_CLASSES.has(evidenceClass)) problems.push(['EVIDENCE-CLASS', path, `unknown class ${evidenceClass}`])
}
for (const path of evidencePaths) {
  if (!positivePaths.includes(path)) problems.push(['EVIDENCE-ORPHAN', path, 'evidence entry is not a positive ledger row'])
}
const evidenceCounts = Object.values(evidence.positiveEntries).reduce((counts, evidenceClass) => {
  counts[evidenceClass] = (counts[evidenceClass] ?? 0) + 1
  return counts
}, {})
for (const evidenceClass of EVIDENCE_CLASSES) {
  const declared = Number(evidence.classes?.[evidenceClass] ?? 0)
  const actual = Number(evidenceCounts[evidenceClass] ?? 0)
  if (declared !== actual) problems.push(['EVIDENCE-COUNT', evidenceClass, `declared=${declared} actual=${actual}`])
}
const exclusionReviewCount = Number(evidence.excludedEntries?.provisionallyDefensible ?? 0)
  + (evidence.excludedEntries?.stale?.length ?? 0)
  + (evidence.excludedEntries?.pendingSourceReview?.length ?? 0)
const excludedPaths = new Set(json.entries.filter((entry) => !entry.status).map((entry) => entry.path))
const excludedCount = excludedPaths.size
const ledgerPaths = new Set(json.entries.map((entry) => entry.path))
for (const [path, record] of Object.entries(provenance.paths ?? {})) {
  if (!ledgerPaths.has(path)) {
    problems.push(['PROVENANCE-ORPHAN', path, 'provenance path is not a ledger row'])
  }
  if (!['historical-anchor', 'incremental-addition'].includes(record.inventoryClass)) {
    problems.push(['PROVENANCE-CLASS', path, `unknown inventory class ${record.inventoryClass}`])
  }
  if (!Array.isArray(record.presenceEpochs) || record.presenceEpochs.length === 0) {
    problems.push(['PROVENANCE-EPOCH', path, 'presenceEpochs must be a non-empty array'])
  } else {
    for (const [index, epoch] of record.presenceEpochs.entries()) {
      if (record.inventoryClass === 'incremental-addition' && !epoch.addedAt) {
        problems.push(['PROVENANCE-EPOCH', path, `epoch ${index} is missing addedAt`])
      }
    }
  }
}
if (!provenance.historicalAnchor.startsWith(json.meta?.anchor_commit ?? '')) {
  problems.push([
    'PROVENANCE-ANCHOR',
    'historicalAnchor',
    `provenance=${provenance.historicalAnchor} ledger=${json.meta?.anchor_commit}`,
  ])
}
if (exclusionReviewCount !== 97) {
  problems.push(['EXCLUSION-FIRST-PASS', 'excludedEntries', `first-pass historical total changed: ${exclusionReviewCount}`])
}

const exactReview = evidence.excludedEntries?.exactReview
if (exactReview) {
  const exactRows = new Map()
  for (const [disposition, paths] of Object.entries(exactReview.dispositions ?? {})) {
    if (!EXCLUSION_DISPOSITIONS.has(disposition)) {
      problems.push(['EXACT-DISPOSITION', disposition, 'unknown exact exclusion disposition'])
      continue
    }
    if (!Array.isArray(paths)) {
      problems.push(['EXACT-DISPOSITION', disposition, 'paths must be an array'])
      continue
    }
    for (const path of paths) {
      if (typeof path !== 'string') {
        problems.push(['EXACT-PATH', disposition, 'path must be a string'])
      } else if (!excludedPaths.has(path)) {
        problems.push(['EXACT-ORPHAN', path, 'exact review path is not an excluded ledger row'])
      } else if (exactRows.has(path)) {
        problems.push(['EXACT-DUPLICATE', path, `${exactRows.get(path)} and ${disposition}`])
      } else {
        exactRows.set(path, disposition)
      }
    }
  }
  const declaredReviewed = Number(exactReview.reviewedRows ?? -1)
  const declaredPending = Number(exactReview.pendingRows ?? -1)
  const exactScope = Number(exactReview.scope?.ledgerExcludedRows ?? excludedCount)
  if (declaredReviewed !== exactRows.size) {
    problems.push(['EXACT-COUNT', 'reviewedRows', `declared=${declaredReviewed} actual=${exactRows.size}`])
  }
  if (exactScope !== excludedCount) {
    problems.push(['EXACT-SCOPE', 'ledgerExcludedRows', `declared=${exactScope} ledger=${excludedCount}`])
  }
  if (declaredPending !== exactScope - exactRows.size) {
    problems.push(['EXACT-COUNT', 'pendingRows', `declared=${declaredPending} actual=${exactScope - exactRows.size}`])
  }
  if (declaredReviewed + declaredPending !== exactScope) {
    problems.push(['EXACT-COUNT', 'total', `reviewed+pending=${declaredReviewed + declaredPending} scope=${exactScope}`])
  }
}

for (const key of META_SEMANTIC) {
  const yamlValue = yamlMeta[key] ?? ''
  const jsonValue = json.meta?.[key] ?? ''
  if (JSON.stringify(yamlValue) !== JSON.stringify(jsonValue)) {
    problems.push([
      'META-DRIFT',
      key,
      `yaml=${JSON.stringify(yamlValue)} json=${JSON.stringify(jsonValue)}`,
    ])
  }
}

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
const exactSummary = exactReview
  ? ` · exact exclusion rows: ${exactReview.reviewedRows}/${excludedCount}`
  : ''
console.log(`evidence: ${evidencePaths.length} positive rows · ${exclusionReviewCount} historical first-pass rows · ${excludedCount} current excluded rows${exactSummary}`)

if (FIX && problems.length) {
  let yamlFixed = 0
  let jsonFixed = 0
  let metaFixed = 0
  const byPath = new Map(yamlEntries.map((e) => [e.path, e]))
  for (const [t, p, d] of problems) {
    if (t === 'META-DRIFT') {
      ;(json.meta ??= {})[p] = yamlMeta[p] ?? ''
      metaFixed++
    } else if (t === 'DRIFT' && d.startsWith('dest: yaml=""')) {
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
  const fixed = metaFixed + yamlFixed + jsonFixed
  if (fixed > 0) {
    writeBack()
    console.log(`fix pass: metadata synced ×${metaFixed}, yaml dest backported ×${yamlFixed}, json fields synced ×${jsonFixed}`)
    process.exit(2) // caller must re-run without --fix to confirm
  }
  console.log('fix pass made no changes; remaining differences require manual repair')
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
