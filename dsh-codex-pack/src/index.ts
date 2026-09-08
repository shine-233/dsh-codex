// dsh-codex-pack integration manifest & ledger health tool.
// Reads dsh-codex-ledger/coverage.json and reports the honest three-tier
// port status (implemented / distilled / design-only) per dest module, plus
// any pending-admission (E0) upstream units. Replaces the v0 install stub.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validatePackLayout } from './preflight.js';

export interface LedgerEntry {
  path: string
  lines?: number
  dest?: string
  code?: string
  status?: string
  audit?: string
}

export interface Ledger {
  meta: { anchor_commit?: string; upstream?: string; [k: string]: unknown }
  entries: LedgerEntry[]
}

export function loadLedger(ledgerJsonPath: string): Ledger {
  if (!existsSync(ledgerJsonPath)) throw new Error(`ledger not found: ${ledgerJsonPath}`)
  return JSON.parse(readFileSync(ledgerJsonPath, 'utf8'))
}

export interface ModuleStatus {
  dest: string
  implemented: number
  distilled: number
  designOnly: number
  upstreamLines: number
}

/** Per-dest-module rollup over the dest-mapped (non-EXCLUDED) entries. */
export function summarizeByModule(ledger: Ledger): ModuleStatus[] {
  const byModule = new Map<string, ModuleStatus>()
  for (const e of ledger.entries) {
    if (!e.dest || e.dest === 'EXCLUDED') continue
    const m = byModule.get(e.dest) ?? { dest: e.dest, implemented: 0, distilled: 0, designOnly: 0, upstreamLines: 0 }
    m.upstreamLines += e.lines ?? 0
    if (e.status === 'implemented') m.implemented++
    else if (e.status === 'distilled') m.distilled++
    else m.designOnly++
    byModule.set(e.dest, m)
  }
  return [...byModule.values()].sort((a, b) => b.upstreamLines - a.upstreamLines)
}

/** Entries still awaiting an admission decision (E0). */
export function pendingAdmissions(ledger: Ledger): LedgerEntry[] {
  return ledger.entries.filter((e) => e.code === 'E0-pending-admission')
}

export { validatePackLayout } from './preflight.js'

/** Human-readable status report; also emitted by the codex_pack_status tool. */
export function statusReport(ledger: Ledger): string {
  const lines: string[] = []
  lines.push(`codex→dsh 移植套件状态 (anchor: ${ledger.meta?.anchor_commit ?? 'unknown'})`)
  lines.push('')
  for (const m of summarizeByModule(ledger)) {
    lines.push(
      `${m.dest}: 已实现 ${m.implemented} · 蒸馏 ${m.distilled} · 仅设计 ${m.designOnly} (上游 ${m.upstreamLines} 行)`,
    )
  }
  const pending = pendingAdmissions(ledger)
  if (pending.length) {
    lines.push('')
    lines.push(`待准入 (E0): ${pending.map((e) => e.path).join(', ')}`)
  }
  return lines.join('\n')
}

export interface InstallationPlan {
  root: string
  dependencies: Record<string, string>
  bundles: string[]
  patchPath: string
}

/** Build a deterministic, side-effect-free install plan after layout validation. */
export function buildInstallPlan(root: string): InstallationPlan {
  const preflight = validatePackLayout(root)
  if (!preflight.ok) throw new Error(`pack preflight failed: ${preflight.errors.join('; ')}`)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { modules: Record<string, string> }
  return {
    root,
    dependencies: { ...manifest.modules },
    bundles: Object.values(manifest.modules),
    patchPath: join(root, 'cordis.patch.yml'),
  }
}

/** Backward-compatible entrypoint: returns a plan and never mutates a profile. */
export function install(root = process.cwd()): InstallationPlan {
  return buildInstallPlan(root)
}

export { writeProfile, type ProfileFileOps, type ProfileWriteOptions, type ProfileWriteResult } from './profileWriter.js'
