import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

export interface PackPreflightResult { ok: boolean; errors: string[]; modules: string[] }

interface PackManifest {
  name?: unknown
  modules?: Record<string, unknown>
  mountPointsDoc?: unknown
}

interface PackageManifest {
  name?: unknown
  main?: unknown
  exports?: unknown
  dsh?: { bundle?: { patch?: unknown } }
}

function readJson(path: string, label: string, errors: string[]): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    errors.push(`${label} is not valid JSON`)
    return undefined
  }
}

function exportedEntry(pkg: PackageManifest): string | undefined {
  const resolveTarget = (target: unknown): string | undefined => {
    if (typeof target === 'string') return target
    if (!target || typeof target !== 'object') return undefined
    const conditions = target as Record<string, unknown>
    return resolveTarget(conditions.import)
      ?? resolveTarget(conditions.node)
      ?? resolveTarget(conditions.default)
      ?? resolveTarget(conditions.require)
  }

  const root = pkg.exports && typeof pkg.exports === 'object'
    ? (pkg.exports as Record<string, unknown>)['.']
    : pkg.exports
  return resolveTarget(root)
    ?? (typeof pkg.main === 'string' ? pkg.main : undefined)
}

interface PatchEntry { id: string; name: string }

function parsePatchEntries(
  path: string,
  label: string,
  errors: string[],
): PatchEntry[] | undefined {
  if (!existsSync(path)) {
    errors.push(`${label} missing (${path})`)
    return undefined
  }
  let parsed: unknown
  try {
    parsed = load(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push(`${label} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${label} top level must be an array`)
    return undefined
  }

  const entries: PatchEntry[] = []
  parsed.forEach((operation, operationIndex) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      errors.push(`${label} operation ${operationIndex + 1} must be an object`)
      return
    }
    const keys = Object.keys(operation)
    if (keys.length !== 1 || keys[0] !== 'insert') {
      errors.push(`${label} operation ${operationIndex + 1} must contain only insert`)
      return
    }
    const insert = (operation as Record<string, unknown>).insert
    if (!Array.isArray(insert)) {
      errors.push(`${label} operation ${operationIndex + 1} insert must be an array`)
      return
    }
    insert.forEach((entry, entryIndex) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${label} insert ${entryIndex + 1} must be an object`)
        return
      }
      const record = entry as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.name !== 'string') {
        errors.push(`${label} insert ${entryIndex + 1} requires string id and name`)
        return
      }
      entries.push({ id: record.id, name: record.name })
    })
  })
  return entries
}

/** Validate package identities, built entries, and aggregate patch agreement. */
export function validatePackLayout(root: string): PackPreflightResult {
  const errors: string[] = []
  const modules: string[] = []
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) return { ok: false, errors: ['manifest.json not found'], modules }
  const manifest = readJson(manifestPath, 'manifest.json', errors) as PackManifest | undefined
  if (!manifest) return { ok: false, errors, modules }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    errors.push('manifest.json name must be a non-empty string')
  }
  if (!manifest.modules || typeof manifest.modules !== 'object' || Array.isArray(manifest.modules)) {
    errors.push('manifest.json modules must be an object')
  } else if (Object.keys(manifest.modules).length === 0) {
    errors.push('manifest.json modules must not be empty')
  }

  const packPackage = readJson(join(root, 'package.json'), 'pack package.json', errors) as PackageManifest | undefined
  if (packPackage && packPackage.name !== manifest.name) {
    errors.push(`pack package name mismatch: manifest=${String(manifest.name)} package.json=${String(packPackage.name)}`)
  }
  if (packPackage) {
    const packEntry = exportedEntry(packPackage)
    if (!packEntry) errors.push('pack package has no runtime export or main entry')
    else if (!existsSync(join(root, packEntry))) errors.push(`pack built entry missing (${join(root, packEntry)})`)
  }
  const packPatchDeclaration = packPackage?.dsh?.bundle?.patch
  if (typeof packPatchDeclaration !== 'string') errors.push('pack package.json declares no dsh.bundle.patch')
  const aggregatePath = typeof packPatchDeclaration === 'string'
    ? join(root, packPatchDeclaration)
    : join(root, 'cordis.patch.yml')
  const aggregateEntries = parsePatchEntries(aggregatePath, 'aggregate patch', errors)

  const packageNames: string[] = []
  const seenPackageNames = new Set<string>()
  for (const [key, value] of Object.entries(manifest.modules ?? {})) {
    if (typeof value !== 'string') {
      errors.push(`${key}: package name must be a string`)
      continue
    }
    const packageName = value
    if (seenPackageNames.has(packageName)) {
      errors.push(`${key}: duplicate package name ${packageName}`)
      continue
    }
    seenPackageNames.add(packageName)
    const localDir = join(root, '..', packageName)
    const packagePath = join(localDir, 'package.json')
    if (!existsSync(packagePath)) {
      errors.push(`${key}: sibling package missing (${localDir})`)
      continue
    }
    const pkg = readJson(packagePath, `${key} package.json`, errors) as PackageManifest | undefined
    if (!pkg) continue
    if (pkg.name !== packageName) {
      errors.push(`${key}: package name mismatch: manifest=${packageName} package.json=${String(pkg.name)}`)
    }
    const entry = exportedEntry(pkg)
    if (!entry) errors.push(`${key}: package has no runtime export or main entry`)
    else if (!existsSync(join(localDir, entry))) errors.push(`${key}: built entry missing (${join(localDir, entry)})`)
    const patchDeclaration = pkg.dsh?.bundle?.patch
    if (typeof patchDeclaration !== 'string') {
      errors.push(`${key}: package declares no dsh.bundle.patch`)
    } else {
      const componentEntries = parsePatchEntries(
        join(localDir, patchDeclaration),
        `${key} bundle patch`,
        errors,
      )
      if (componentEntries && (
        componentEntries.length !== 1
        || componentEntries[0].id !== packageName
        || componentEntries[0].name !== packageName
      )) {
        errors.push(`${key}: bundle patch must insert exactly ${packageName} with matching id and name`)
      }
    }
    packageNames.push(packageName)
    modules.push(key)
  }

  if (aggregateEntries) {
    const expectedEntries = packageNames.map(name => ({ id: name, name }))
    if (JSON.stringify(aggregateEntries) !== JSON.stringify(expectedEntries)) {
      const found = aggregateEntries.map(entry => `${entry.id}:${entry.name}`).join(', ')
      errors.push(`aggregate patch modules differ: expected ${packageNames.join(', ')}; found ${found}`)
    }
  }
  const mountPointsDoc = typeof manifest.mountPointsDoc === 'string' ? manifest.mountPointsDoc : 'docs/MOUNT_POINTS.md'
  if (!existsSync(join(root, mountPointsDoc))) errors.push(`${mountPointsDoc} missing`)
  return { ok: errors.length === 0, errors, modules }
}
