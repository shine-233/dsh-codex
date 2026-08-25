// dsh plugin entry for codex-edit-fusion (from openai/codex apply-patch V4A, Apache-2.0)
// Provides a model-facing tool that applies fuzzy V4A patches to workspace files.
import { readFile, writeFile } from 'node:fs/promises';
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

export function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return
  const defineTool = (d) => d
  const root = typeof config.root === 'string' && config.root ? config.root : undefined
  ctx.tools.register(defineTool({
    name: 'codex_apply_patch',
    description: 'Apply an openai/codex V4A patch (*** Begin Patch ... Update/Add/Delete File ...) to files under the working directory. Fuzzy context matching with atomic per-file writes.',
    parameters: {
      patch: { type: 'string', required: true, description: 'full V4A patch text beginning with *** Begin Patch' },
      cwd: { type: 'string', description: 'base directory for relative paths; defaults to process.cwd()' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const base = resolve(isAbsolute(String(args?.cwd ?? '')) ? String(args.cwd) : join(process.cwd(), String(args?.cwd ?? '.')))
      const patch = parsePatch(String(args?.patch ?? ''))
      const files = new Map()
      for (const p of touchedPaths(patch)) {
        try { files.set(p, await readFile(join(base, p), 'utf8')) } catch { /* new file or unreadable */ }
      }
      const res = applyPatch(patch, files, (lines, pattern, start) => seekSequence(lines, pattern, start))
      for (const [p, content] of res.files) {
        if (content === files.get(p)) continue
        await writeFile(join(base, p), content, 'utf8')
      }
      for (const del of patch.deleteFiles) {
        try { const { rm } = await import('node:fs/promises'); await rm(join(base, del)) } catch { /* ignore */ }
      }
      return JSON.stringify({ applied: res.results, errors: res.errors }, null, 2)
    },
    timeoutMs: 15000,
  }))
}

export { parsePatch, applyPatch, seekSequence }
