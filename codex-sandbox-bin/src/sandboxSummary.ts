// Distilled from openai/codex utils/sandbox-summary + diagnostics
// (Apache-2.0, rust-v0.153.4): a summary face over the vendored sandbox
// binaries (which platform variants are present and runnable) plus a
// diagnostics snapshot (gauges/counters) for the plugin.
import { binPaths } from './dsh-plugin.js'

export interface SandboxSummary {
  platformKey: string
  binaries: { name: string; bytes: number; present: boolean }[]
  complete: boolean
}

/** Summarize the vendored sandbox binaries for the current platform. */
export function sandboxSummary(): SandboxSummary {
  const bp = binPaths()
  const expected = process.platform === 'win32'
    ? ['codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']
    : ['codex-linux-sandbox']
  const binaries = expected.map((name) => {
    const b = bp.binaries[name]
    return { name, bytes: b?.bytes ?? 0, present: Boolean(b) }
  })
  return { platformKey: bp.platformKey, binaries, complete: binaries.every((b) => b.present) }
}

// ── diagnostics gauges (upstream diagnostics crate face) ────────────────────

const counters = new Map<string, number>()
const gauges = new Map<string, number>()

export function incrementCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by)
}

export function setGauge(name: string, value: number): void {
  gauges.set(name, value)
}

export function diagnosticsSnapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
  return {
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
  }
}
