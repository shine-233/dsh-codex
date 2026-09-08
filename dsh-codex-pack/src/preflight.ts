import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PackPreflightResult { ok: boolean; errors: string[]; modules: string[] }

/** Validate the checked-out pack layout before installing it into a dsh profile. */
export function validatePackLayout(root: string): PackPreflightResult {
  const errors: string[] = []
  const modules: string[] = []
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) return { ok: false, errors: ['manifest.json not found'], modules }
  let manifest: { modules?: Record<string, string> }
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { return { ok: false, errors: ['manifest.json is not valid JSON'], modules } }
  for (const [key, packageName] of Object.entries(manifest.modules ?? {})) {
    const localDir = join(root, '..', packageName.split('/').pop()!.replace(/^@[^/]+\//, ''))
    if (!existsSync(localDir)) errors.push(`${key}: sibling package missing (${localDir})`)
    else modules.push(key)
  }
  if (!existsSync(join(root, 'cordis.patch.yml'))) errors.push('cordis.patch.yml missing')
  if (!existsSync(join(root, 'docs', 'MOUNT_POINTS.md'))) errors.push('docs/MOUNT_POINTS.md missing')
  return { ok: errors.length === 0, errors, modules }
}
