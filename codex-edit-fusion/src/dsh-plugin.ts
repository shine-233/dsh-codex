// dsh plugin entry for codex-edit-fusion (from openai/codex apply-patch V4A, Apache-2.0)
// Provides a model-facing tool that applies fuzzy V4A patches to workspace files.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parsePatch, applyPatch } from './v4aParser.js';
import { seekSequence } from './seekSequence.js';

export const name = 'codex-edit-fusion'
export const inject = ['tools']

function touchedPaths(patch) {
  const paths = new Set()
  for (const u of patch.updateFiles) { paths.add(u.path); if (u.moveTo) paths.add(u.moveTo) }
  for (const a of patch.addFiles) paths.add(a.path)
  for (const d of patch.deleteFiles) paths.add(d)
  return [...paths]
}

export function apply(ctx: any, config: { root?: string } = {}) {
  if (!ctx?.tools?.register) return
  const defineTool = (d: any) => d
  const root = typeof config.root === 'string' && config.root ? config.root : undefined
  ctx.tools.register(defineTool({
    name: 'codex_apply_patch',
    description: 'Apply an openai/codex V4A patch (*** Begin Patch ... Update/Add/Delete File ...) to files under the working directory. Fuzzy context matching with atomic per-file writes.',
    parameters: {
      patch: { type: 'string', required: true, description: 'full V4A patch text beginning with *** Begin Patch' },
      cwd: { type: 'string', description: 'base directory for relative paths; defaults to process.cwd()' },
    },
    output: { schema: { type: 'string' }, render: (_a: any, v: string) => [{ type: 'text', text: v }] },
    async execute(args: any) {
      const configuredRoot = root ?? process.cwd()
      const base = resolve(isAbsolute(String(args?.cwd ?? '')) ? String(args.cwd) : join(configuredRoot, String(args?.cwd ?? '.')))
      const patch = parsePatch(String(args?.patch ?? ''))
      const files = new Map()
      for (const p of touchedPaths(patch)) {
        try { files.set(p, await readFile(join(base, p), 'utf8')) } catch { /* new file or unreadable */ }
      }
      const res = applyPatch(patch, files, (lines, pattern, start) => seekSequence(lines, pattern, start))
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
