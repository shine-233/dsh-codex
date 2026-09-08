// dsh plugin entry for codex-edit-fusion (from openai/codex apply-patch V4A, Apache-2.0)
// Provides a model-facing tool that applies fuzzy V4A patches to workspace files.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parsePatch, applyPatch, type Patch } from './v4aParser.js';
import { seekSequence } from './seekSequence.js';

export const name = 'codex-edit-fusion'
export const inject = ['tools']

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function touchedPaths(patch: Patch): string[] {
  const paths = new Set<string>()
  for (const u of patch.updateFiles) { paths.add(u.path); if (u.moveTo) paths.add(u.moveTo) }
  for (const a of patch.addFiles) paths.add(a.path)
  for (const d of patch.deleteFiles) paths.add(d)
  return [...paths]
}

export function apply(ctx: unknown, config: unknown = {}): void {
  const tools = (ctx as { tools?: { register?: (definition: unknown) => void } } | null)?.tools
  if (!tools?.register) return
  const defineTool = (definition: unknown): unknown => definition
  const cfg = asRecord(config)
  const root = typeof cfg.root === 'string' && cfg.root ? cfg.root : undefined
  tools.register(defineTool({
    name: 'codex_apply_patch',
    description: 'Apply an openai/codex V4A patch (*** Begin Patch ... Update/Add/Delete File ...) to files under the working directory. Fuzzy context matching with atomic per-file writes.',
    parameters: {
      patch: { type: 'string', required: true, description: 'full V4A patch text beginning with *** Begin Patch' },
      cwd: { type: 'string', description: 'base directory for relative paths; defaults to process.cwd()' },
    },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }] },
    async execute(rawArgs: unknown): Promise<string> {
      const args = asRecord(rawArgs)
      const configuredRoot = root ?? process.cwd()
      const cwd = typeof args.cwd === 'string' ? args.cwd : ''
      const base = resolve(isAbsolute(cwd) ? cwd : join(configuredRoot, cwd || '.'))
      const patch = parsePatch(String(args.patch ?? ''))
      const files = new Map<string, string>()
      for (const p of touchedPaths(patch)) {
        try { files.set(p, await readFile(join(base, p), 'utf8')) } catch { /* new file or unreadable */ }
      }
      const res = applyPatch(
        patch,
        files,
        (lines, pattern, start, eof) => seekSequence(lines, pattern, start, eof, 'NormalizeToLf'),
      )
      if (res.errors.length > 0) return JSON.stringify({ applied: [], errors: res.errors }, null, 2)

      // Commit the validated map as one logical operation. If any physical
      // write/remove fails, restore every touched path from the snapshot read
      // above so callers never observe a partially applied patch.
      const touched = touchedPaths(patch)
      try {
        for (const [p, content] of res.files) {
          if (content === files.get(p)) continue
          await writeFile(join(base, p), content, 'utf8')
        }
        for (const upd of patch.updateFiles) {
          if (!upd.moveTo || upd.moveTo === upd.path) continue
          await rm(join(base, upd.path), { force: true })
        }
        for (const del of patch.deleteFiles) await rm(join(base, del), { force: true })
      } catch (error) {
        for (const p of touched) {
          try {
            if (files.has(p)) await writeFile(join(base, p), files.get(p)!, 'utf8')
            else await rm(join(base, p), { force: true })
          } catch { /* best-effort rollback; retain original failure below */ }
        }
        return JSON.stringify({ applied: [], errors: [`write transaction failed: ${String(error)}`] }, null, 2)
      }
      return JSON.stringify({ applied: res.results, errors: [] }, null, 2)
    },
    timeoutMs: 15000,
  }))
}

export { parsePatch, applyPatch, seekSequence }
