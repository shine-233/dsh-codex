import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative } from 'node:path'
import type { InstallationPlan } from './index.js'

export interface ProfileWriteResult {
  mode: 'dry-run' | 'apply'
  packageJsonPath: string
  dependencyCount: number
  bundles: string[]
  changed: boolean
}

export interface ProfileWriteOptions {
  /** Test seam for exercising package.json replacement and rollback. */
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

/** Prepare or apply aggregate-pack links in a profile package.json. */
export function writeProfile(
  plan: InstallationPlan,
  profileDir: string,
  mode: 'dry-run' | 'apply' = 'dry-run',
  options: ProfileWriteOptions = {},
): ProfileWriteResult {
  const ops = { ...defaultFileOps, ...(options.fileOps ?? {}) }
  const packageJsonPath = join(profileDir, 'package.json')
  if (!ops.exists(packageJsonPath)) throw new Error(`profile package.json not found: ${packageJsonPath}`)
  const packageText = ops.read(packageJsonPath)
  const pkg = JSON.parse(packageText) as Record<string, any>
  const dependencies = { ...(pkg.dependencies ?? {}) }
  for (const [packageName, packageDir] of Object.entries(plan.dependencies)) {
    dependencies[packageName] = `link:${relative(profileDir, packageDir).replace(/\\/g, '/')}`
  }
  const bundles = Array.from(new Set([...(pkg.dsh?.profile?.bundles ?? []), ...plan.bundles]))
  const nextPkg = { ...pkg, dependencies, dsh: { ...(pkg.dsh ?? {}), profile: { ...(pkg.dsh?.profile ?? {}), bundles } } }
  const nextJson = `${JSON.stringify(nextPkg, null, 2)}\n`
  const changed = nextJson !== packageText
  if (mode !== 'apply' || !changed) {
    return { mode, packageJsonPath, dependencyCount: Object.keys(plan.dependencies).length, bundles, changed }
  }

  ops.mkdir(profileDir)
  const packageTemp = temporaryPath(packageJsonPath)
  const packageRollback = temporaryPath(packageJsonPath)
  const packageBackup = `${packageJsonPath}.bak`
  let packageReplaced = false
  try {
    ops.write(packageTemp, nextJson)
    ops.copy(packageJsonPath, packageRollback)
    if (!ops.exists(packageBackup)) ops.copy(packageJsonPath, packageBackup)
    packageReplaced = true
    ops.rename(packageTemp, packageJsonPath)
  } catch (error) {
    try {
      if (packageReplaced) ops.copy(packageRollback, packageJsonPath)
    } catch (rollbackError) {
      throw new Error(`profile installation failed and rollback failed: ${String(rollbackError)}`, { cause: error })
    }
    throw error
  } finally {
    for (const path of [packageTemp, packageRollback]) {
      if (ops.exists(path)) ops.unlink(path)
    }
  }
  return { mode, packageJsonPath, dependencyCount: Object.keys(plan.dependencies).length, bundles, changed }
}
