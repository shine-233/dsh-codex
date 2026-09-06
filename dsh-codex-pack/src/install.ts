// dsh plugin entry for dsh-codex-pack: suite-level status/health reporting.
// Registers a read-only codex_pack_status tool that summarizes the ledger.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedger, statusReport, pendingAdmissions } from './index.js';

export const name = 'dsh-codex-pack'
export const inject = ['tools']

const here = dirname(fileURLToPath(import.meta.url))

function resolveLedgerPath(config: Record<string, unknown>): string {
  if (typeof config.ledgerPath === 'string' && config.ledgerPath) return config.ledgerPath
  // Default: sibling dsh-codex-ledger checkout next to this package.
  return join(here, '..', '..', '..', 'dsh-codex-ledger', 'coverage.json')
}

export function apply(ctx: unknown, config: Record<string, unknown> = {}): void {
  const tools = (ctx as { tools?: { register?: (d: unknown) => void } })?.tools
  if (!tools?.register) return
  const defineTool = (d: unknown) => d
  const ledgerPath = resolveLedgerPath(config)
  tools.register(defineTool({
    name: 'codex_pack_status',
    description: 'Report the codex→dsh port suite status from the ledger: per-module implemented/distilled/design-only rollup, upstream line counts, and pending admissions. Read-only.',
    parameters: {
      ledgerPath: { type: 'string', description: 'optional path to coverage.json (defaults to the sibling dsh-codex-ledger checkout)' },
    },
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] },
    async execute(args: { ledgerPath?: string }) {
      const ledger = loadLedger(args?.ledgerPath ?? ledgerPath)
      const report = statusReport(ledger)
      const pending = pendingAdmissions(ledger)
      return JSON.stringify({ ledgerPath: args?.ledgerPath ?? ledgerPath, report, pendingCount: pending.length }, null, 2)
    },
    timeoutMs: 3000,
  }))
}
