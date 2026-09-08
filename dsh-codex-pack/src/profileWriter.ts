import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative } from 'node:path'
import type { InstallationPlan } from './index.js'

export interface ProfileWriteResult {
  mode: 'dry-run' | 'apply'
  packageJsonPath: string
  patchPath: string
  dependencyCount: number
  bundles: string[]
  changed: boolean
}

export interface ProfileWriteOptions {
  /** Permit replacing a non-empty patch file whose contents differ. */
  overwritePatch?: boolean
  /** Test seam for exercising the two-file transaction boundary. */
  fileOps?: Partial<ProfileFileOps>
}

export interface ProfileFileOps {
  exists(path: string): boolean
  mkdir(path: string): void
  read(path: string): string
  write(path: string, contents: string): void
  copy(source: string, destination: string): void
  rename(source: string, destination: string): void
  unlink(path: string): void
}

const defaultFileOps: ProfileFileOps = {
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, contents) => writeFileSync(path, contents, 'utf8'),
  copy: copyFileSync,
  rename: renameSync,
  unlink: unlinkSync,
}

function temporaryPath(path: string): string {
  return `${path}.codex-tmp-${process.pid}-${randomUUID()}`
}

/** Prepare or apply a profile package.json + cordis.patch.yml installation. */
export function writeProfile(
  plan: InstallationPlan,
  profileDir: string,
  mode: 'dry-run' | 'apply' = 'dry-run',
  options: ProfileWriteOptions = {},
): ProfileWriteResult {
  const ops = { ...defaultFileOps, ...(options.fileOps ?? {}) }
  const packageJsonPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!ops.exists(packageJsonPath)) throw new Error(`profile package.json not found: ${packageJsonPath}`)
  const packageText = ops.read(packageJsonPath)
  const pkg = JSON.parse(packageText) as Record<string, any>
  const dependencies = { ...(pkg.dependencies ?? {}) }
  for (const packageName of plan.bundles) {
    const sibling = join(plan.root, '..', packageName.split('/').pop()!)
    dependencies[packageName] = `link:${relative(profileDir, sibling).replace(/\\/g, '/')}`
  }
  const bundles = Array.from(new Set([...(pkg.dsh?.profile?.bundles ?? []), ...plan.bundles]))
  const nextPkg = { ...pkg, dependencies, dsh: { ...(pkg.dsh ?? {}), profile: { ...(pkg.dsh?.profile ?? {}), bundles } } }
  const patchText = ops.read(plan.patchPath)
  const nextJson = `${JSON.stringify(nextPkg, null, 2)}\n`
  const hasPatch = ops.exists(patchPath)
  const currentPatch = hasPatch ? ops.read(patchPath) : undefined
  const packageChanged = nextJson !== packageText
  const patchChanged = currentPatch !== patchText
  if (hasPatch && currentPatch!.trim().length > 0 && patchChanged && !options.overwritePatch) {
    throw new Error(`existing cordis.patch.yml differs: ${patchPath}; pass overwritePatch: true to replace it`)
  }
  const changed = packageChanged || !hasPatch || patchChanged
  if (mode !== 'apply' || !changed) {
    return { mode, packageJsonPath, patchPath, dependencyCount: plan.bundles.length, bundles, changed }
  }

  ops.mkdir(profileDir)
  const packageTemp = temporaryPath(packageJsonPath)
  const patchTemp = temporaryPath(patchPath)
  const packageRollback = temporaryPath(packageJsonPath)
  const patchRollback = temporaryPath(patchPath)
  const packageBackup = `${packageJsonPath}.bak`
  const patchBackup = `${patchPath}.bak`
  let packageReplaced = false
  let patchReplaced = false
  try {
    ops.write(packageTemp, nextJson)
    if (patchChanged) ops.write(patchTemp, patchText)
    ops.copy(packageJsonPath, packageRollback)
    if (!ops.exists(packageBackup)) ops.copy(packageJsonPath, packageBackup)
    if (hasPatch) {
      ops.copy(patchPath, patchRollback)
      if (patchChanged && !ops.exists(patchBackup)) ops.copy(patchPath, patchBackup)
    }
    if (packageChanged) {
      packageReplaced = true
      ops.rename(packageTemp, packageJsonPath)
    }
    if (patchChanged) {
      patchReplaced = true
      ops.rename(patchTemp, patchPath)
    }
  } catch (error) {
    try {
      if (packageReplaced) ops.copy(packageRollback, packageJsonPath)
      if (patchReplaced) {
        if (hasPatch) ops.copy(patchRollback, patchPath)
        else if (ops.exists(patchPath)) ops.unlink(patchPath)
      } else if (!hasPatch && ops.exists(patchPath)) {
        ops.unlink(patchPath)
      }
    } catch (rollbackError) {
      throw new Error(`profile installation failed and rollback failed: ${String(rollbackError)}`, { cause: error })
    }
    throw error
  } finally {
    for (const path of [packageTemp, patchTemp, packageRollback, patchRollback]) {
      if (ops.exists(path)) ops.unlink(path)
    }
  }
  return { mode, packageJsonPath, patchPath, dependencyCount: plan.bundles.length, bundles, changed }
}
