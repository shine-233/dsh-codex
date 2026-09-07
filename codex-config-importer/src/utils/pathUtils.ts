// Port of openai/codex utils/path-utils (Apache-2.0, rust-v0.153.4):
// cross-platform path comparison/normalization helpers.
import { isAbsolute, resolve, sep } from 'node:path'

/** Windows accepts both separators; normalize to one for comparison. */
function normalizeSeparators(p: string): string {
  return p.replace(/[\\/]+/g, sep)
}

/** Case-fold + separator-normalize a path for comparison (Windows is case-insensitive). */
export function normalizeForPathComparison(path: string): string {
  const abs = resolve(normalizeSeparators(path))
  const folded = process.platform === 'win32' ? abs.toLowerCase() : abs
  return folded
}

export function pathsMatchAfterNormalization(left: string, right: string): boolean {
  return normalizeForPathComparison(left) === normalizeForPathComparison(right)
}

/** Keep relative workdirs relative; absolutize only when already absolute. */
export function normalizeForNativeWorkdir(path: string): string {
  if (isAbsolute(path)) return resolve(normalizeSeparators(path))
  return normalizeSeparators(path)
}

export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.WSL_DISTRO_NAME || /microsoft/i.test(env.PROC_VERSION ?? '')
}
