// dsh plugin entry for dsh-codex-ledger (porting ledger & master plan, codex->dsh)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-codex-ledger'
export const inject = ['tools']

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadCoverage() {
  for (const f of ['coverage.json', 'coverage.yaml']) {
    const p = join(ROOT, f)
    try { return { file: f, raw: readFileSync(p, 'utf8') } } catch { /* next */ }
  }
  return null
}

function summarize(text, isJson) {
  if (isJson) {
    try {
      const j0 = JSON.parse(text)
      // coverage.json shape: { meta?, entries: [{path, lines, dest, code, note}] }
      const rows = j0.entries ?? j0.rows ?? (Array.isArray(j0) ? j0 : null)
      const byTarget = {}
      let total = 0
      const push = (t) => { total++; byTarget[t] = (byTarget[t] ?? 0) + 1 }
      if (Array.isArray(rows)) {
        for (const r of rows) push(String(r?.dest ?? r?.target ?? r?.repo ?? 'unknown'))
      }
      return { total, byTarget, anchor: j0.meta?.anchor ?? j0.anchor ?? undefined }
    } catch { /* fall through */ }
  }
  const lines = text.split(/\r?\n/).filter((l) => /^\s*-\s/.test(l)).length
  return { total: lines, note: 'approximate (parsed from YAML list)' }
}

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const defineTool = (d) => d
  ctx.tools.register(defineTool({
    name: 'codex_ledger_status',
    description: 'Summarize the codex->dsh porting ledger: how many upstream units are tracked and where they went (R1..R10 repos / E* exclusions).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute() {
      const cov = loadCoverage()
      if (!cov) return JSON.stringify({ error: 'coverage.json/yaml not found next to plugin lib/' })
      return JSON.stringify({ file: cov.file, ...summarize(cov.raw, cov.file.endsWith('.json')) }, null, 2)
    },
    timeoutMs: 3000,
  }))
}
