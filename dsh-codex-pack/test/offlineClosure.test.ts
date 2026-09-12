// Publication-closure proof for the codex→dsh pack.
//
// The acceptance gate distinguishes install proof paths and refuses to let one
// stand in for another:
//
//   1. sibling-lib activation — sibling source directories. Development only;
//      it proves nothing about publication.
//   2. offline multi-tarball — one real npm tarball per package, installed with
//      no network from `file:` specs.
//   3. offline single-tarball — ONE npm tarball that bundles every component
//      (npm `bundleDependencies`), installed with no network.
//   4. clean registry install — resolved from a real registry by package name.
//      Out of scope for an offline test; see docs/PUBLICATION-CLOSURE.md.
//
// A custom importer, or a hand-built node_modules, proves none of them.
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, readFile, access, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildInstallPlan, validatePackLayout } from '../src/index.js'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

/** The eight component packages the default integration bundle is made of. */
const COMPONENTS = [
  'codex-policy-engine',
  'codex-edit-fusion',
  'codex-config-importer',
  'codex-prompts',
  'codex-session-kit',
  'codex-net-guard',
  'codex-schema',
  'codex-skills-kit',
] as const
const PACK = 'dsh-codex-pack'

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function npm(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(npmBin(), args, {
    cwd,
    // Windows resolves `npm` through a .cmd shim, which needs a shell.
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
  })
  return stdout
}

/** List the entries inside one npm tarball. */
async function tarballEntries(tarball: string): Promise<string[]> {
  // `--force-local`: without it, Windows tar reads `C:\...` as a remote host.
  const { stdout } = await execFileAsync('tar', ['--force-local', '-tzf', tarball], {
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout.split(/\r?\n/).filter(Boolean)
}

/** Produce one real npm tarball per package into `distDir` (package -> path). */
async function packEach(names: readonly string[], distDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const name of names) {
    const stdout = await npm(['pack', '--pack-destination', distDir, '--ignore-scripts'], join(REPO_ROOT, name))
    const file = stdout.trim().split(/\r?\n/).filter(Boolean).pop()
    if (!file) throw new Error(`npm pack produced no tarball for ${name}`)
    out.set(name, join(distDir, file))
  }
  return out
}

async function writeConsumer(dir: string, deps: Record<string, string>): Promise<void> {
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'closure-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: deps,
  }, null, 2))
}

/**
 * Every installed package must expose a loadable built export.
 *
 * DSH plugin packages import their host's `@deepseek-ai/dsh-*` services at
 * module scope, and those services are supplied by the host rather than by the
 * package. So a load that fails may only fail because a HOST peer is absent —
 * never because the package shipped an incomplete or broken artifact. Anything
 * else is a real closure failure.
 */
async function assertInstalledClosure(dir: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    // A bundled dependency is nested under its bundler rather than hoisted.
    const candidates = [
      join(dir, 'node_modules', name, 'lib', 'index.js'),
      join(dir, 'node_modules', PACK, 'node_modules', name, 'lib', 'index.js'),
    ]
    let entry: string | undefined
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const found = await access(candidate).then(() => true, () => false)
      if (found) { entry = candidate; break }
    }
    expect(entry, `${name} built entry must be installed`).toBeDefined()
    entry = entry!
    const loaded = await import(pathToFileURL(entry).href)
      .then(mod => ({ ok: true as const, mod: mod as Record<string, unknown> }))
      .catch((error: NodeJS.ErrnoException & { message?: string }) => ({ ok: false as const, error }))
    if (loaded.ok) {
      if (name === PACK) {
        // The aggregate is a tool package, not a plugin: it ships the layout
        // validator and the install planner rather than a Cordis `apply`.
        expect(typeof loaded.mod.validatePackLayout, 'pack must export validatePackLayout').toBe('function')
        expect(typeof loaded.mod.buildInstallPlan, 'pack must export buildInstallPlan').toBe('function')
      } else {
        expect(typeof loaded.mod.apply, `${name} must export apply`).toBe('function')
        expect(loaded.mod.name, `${name} package name must match its export`).toBe(name)
        expect(Array.isArray(loaded.mod.inject), `${name} must export inject`).toBe(true)
      }
      continue
    }
    expect(loaded.error.code, `${name} must load or fail only on a missing host peer`).toBe('ERR_MODULE_NOT_FOUND')
    expect(String(loaded.error.message), `${name} may only miss a host-supplied dsh service`)
      .toContain('@deepseek-ai/dsh-')
  }
}

describe('publication closure', () => {
  it('labels sibling-lib activation as NOT publication closure', () => {
    const plan = buildInstallPlan(join(REPO_ROOT, PACK)) as unknown as Record<string, unknown>
    // Sibling activation resolves dependencies to local source directories, so
    // it can never stand in for a registry or tarball install.
    expect(plan.mode).toBe('sibling-lib')
    expect(plan.publicationClosure).toBe(false)
    const deps = plan.dependencies as Record<string, string>
    for (const [name, target] of Object.entries(deps)) {
      expect(target, `${name} must resolve to a local source dir in sibling mode`).toContain(name)
      expect(resolve(target), `${name} dependency must be an absolute path`).toBe(target)
    }
  })

  it('packs only the published surface, never the working tree', async () => {
    const work = await mkdtemp(join(tmpdir(), 'closure-surface-'))
    try {
      const distDir = join(work, 'dist')
      await mkdir(distDir, { recursive: true })
      const tarballs = await packEach([...COMPONENTS, PACK], distDir)
      for (const [name, tarball] of tarballs) {
        const entries = await tarballEntries(tarball)
        expect(entries, `${name} must publish its built entry`).toContain('package/lib/index.js')
        expect(entries, `${name} must publish its bundle patch`).toContain('package/cordis.patch.yml')
        // The published surface is bounded: no working-tree-only material ships.
        expect(entries.some(e => e.startsWith('package/test/')), `${name} must not publish test/`).toBe(false)
        expect(entries.some(e => e.startsWith('package/node_modules/')), `${name} must not publish node_modules/`).toBe(false)
        expect(entries.some(e => e.includes('pnpm-lock.yaml')), `${name} must not publish lockfiles`).toBe(false)
        expect(entries.some(e => e.includes('package-lock.json')), `${name} must not publish lockfiles`).toBe(false)
        // `src/` ships only where the published `types` entry points into it
        // (codex-edit-fusion); otherwise the working tree stays out.
        const publishedTypes = (JSON.parse(await readFile(join(REPO_ROOT, name, 'package.json'), 'utf8')) as {
          exports?: { '.'?: { types?: string } }
        }).exports?.['.']?.types
        const srcAllowed = typeof publishedTypes === 'string' && publishedTypes.startsWith('./src/')
        if (!srcAllowed) {
          expect(entries.some(e => e.startsWith('package/src/')),
            `${name} must not publish src/ unless its types entry requires it`).toBe(false)
        }
      }
    } finally {
      await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }, 600_000)

  it('installs every component offline from per-package tarballs', async () => {
    const work = await mkdtemp(join(tmpdir(), 'closure-multi-'))
    try {
      const distDir = join(work, 'dist')
      await mkdir(distDir, { recursive: true })
      const tarballs = await packEach([...COMPONENTS, PACK], distDir)
      expect(tarballs.size).toBe(9)

      const consumer = join(work, 'consumer')
      await mkdir(consumer, { recursive: true })
      const deps: Record<string, string> = {}
      for (const [name, tarball] of tarballs) deps[name] = `file:${tarball.replace(/\\/g, '/')}`
      await writeConsumer(consumer, deps)
      // `--legacy-peer-deps`: every `@deepseek-ai/dsh-*` service is supplied by
      // the DSH host, not by the package. The closure under test is the codex
      // packages' own installability, so peers are not resolved here.
      await npm(['install', '--offline', '--no-audit', '--no-fund', '--legacy-peer-deps'], consumer)

      await assertInstalledClosure(consumer, [...COMPONENTS, PACK])

      // The installed pack still passes its own layout preflight.
      const layout = validatePackLayout(join(consumer, 'node_modules', PACK))
      expect(layout.errors).toEqual([])
      expect(layout.ok).toBe(true)
    } finally {
      await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }, 600_000)

  it('installs the whole bundle offline from one bundled aggregate tarball', async () => {
    const work = await mkdtemp(join(tmpdir(), 'closure-single-'))
    try {
      const distDir = join(work, 'dist')
      await mkdir(distDir, { recursive: true })
      const componentTarballs = await packEach([...COMPONENTS], distDir)

      // Stage a copy of the pack that declares the components as bundled
      // dependencies, install them from their tarballs, then pack ONE tarball:
      // npm inlines every bundled dependency into that single artifact.
      const stage = join(work, 'stage')
      await mkdir(stage, { recursive: true })
      const packRoot = join(REPO_ROOT, PACK)
      await cp(join(packRoot, 'lib'), join(stage, 'lib'), { recursive: true })
      await cp(join(packRoot, 'docs'), join(stage, 'docs'), { recursive: true })
      for (const file of ['package.json', 'cordis.patch.yml', 'manifest.json', 'README.md', 'NOTICE.md']) {
        await cp(join(packRoot, file), join(stage, file))
      }
      const stagedManifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')) as Record<string, unknown>
      // Merge, never replace: the pack's own runtime dependency (js-yaml) must
      // survive into the aggregate or the artifact is broken for consumers.
      const existingDeps = (stagedManifest.dependencies ?? {}) as Record<string, string>
      stagedManifest.dependencies = {
        ...existingDeps,
        ...Object.fromEntries(
          [...componentTarballs].map(([name, tarball]) => [name, `file:${tarball.replace(/\\/g, '/')}`]),
        ),
      }
      stagedManifest.bundleDependencies = [...COMPONENTS]
      // A published package installs no devDependencies; keeping them here
      // would drag the pack's own test toolchain into the closure.
      delete (stagedManifest as Record<string, unknown>).devDependencies
      await writeFile(join(stage, 'package.json'), JSON.stringify(stagedManifest, null, 2))
      await npm(['install', '--offline', '--no-audit', '--no-fund', '--legacy-peer-deps'], stage)

      const packed = await npm(['pack', '--pack-destination', distDir, '--ignore-scripts'], stage)
      const aggregateName = packed.trim().split(/\r?\n/).filter(Boolean).pop()
      expect(aggregateName, 'aggregate tarball must be produced').toBeDefined()
      const aggregate = join(distDir, aggregateName!)

      // The single artifact really carries every component inside it.
      const entries = await tarballEntries(aggregate)
      for (const name of COMPONENTS) {
        expect(entries.some(e => e.includes(`node_modules/${name}/lib/index.js`)),
          `aggregate must bundle ${name}`).toBe(true)
      }

      const consumer = join(work, 'consumer')
      await mkdir(consumer, { recursive: true })
      await writeConsumer(consumer, { [PACK]: `file:${aggregate.replace(/\\/g, '/')}` })
      await npm(['install', '--offline', '--no-audit', '--no-fund', '--legacy-peer-deps'], consumer)
      await assertInstalledClosure(consumer, [...COMPONENTS, PACK])
    } finally {
      await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }, 600_000)
})
