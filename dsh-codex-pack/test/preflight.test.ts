import { describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validatePackLayout } from '../src/preflight'

interface Fixture {
  root: string
  parent: string
  component: string
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function makeFixture(): Fixture {
  const parent = mkdtempSync(join(tmpdir(), 'dsh-pack-preflight-'))
  const root = join(parent, 'dsh-codex-pack')
  const component = join(parent, 'component-a')
  mkdirSync(join(root, 'lib'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(component, 'lib'), { recursive: true })

  writeJson(join(root, 'manifest.json'), {
    name: 'dsh-codex-pack',
    modules: { a: 'component-a' },
    mountPointsDoc: 'docs/MOUNT_POINTS.md',
  })
  writeJson(join(root, 'package.json'), {
    name: 'dsh-codex-pack',
    exports: { '.': { import: './lib/index.js' } },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(root, 'lib', 'index.js'), 'export const ok = true\n')
  writeFileSync(join(root, 'docs', 'MOUNT_POINTS.md'), '# fixture\n')
  writeFileSync(join(root, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: component-a',
    '      name: component-a',
    '',
  ].join('\n'))

  writeJson(join(component, 'package.json'), {
    name: 'component-a',
    exports: { '.': { import: './lib/index.js' } },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(component, 'lib', 'index.js'), 'export const apply = true\n')
  writeFileSync(join(component, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: component-a',
    '      name: component-a',
    '',
  ].join('\n'))
  return { root, parent, component }
}

function withFixture(run: (fixture: Fixture) => void): void {
  const fixture = makeFixture()
  try {
    run(fixture)
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true })
  }
}

describe('pack preflight failure modes', () => {
  it('accepts conditional import exports', () => withFixture(({ root }) => {
    expect(validatePackLayout(root)).toEqual({ ok: true, errors: [], modules: ['a'] })
  }))

  it('rejects a mismatched package identity', () => withFixture(({ root, component }) => {
    writeJson(join(component, 'package.json'), {
      name: 'wrong-name',
      main: './lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    expect(validatePackLayout(root).errors).toContain(
      'a: package name mismatch: manifest=component-a package.json=wrong-name',
    )
  }))

  it('rejects a missing built export', () => withFixture(({ root, component }) => {
    rmSync(join(component, 'lib', 'index.js'))
    expect(validatePackLayout(root).errors.some(error => error.startsWith('a: built entry missing'))).toBe(true)
  }))

  it('rejects malformed aggregate operations', () => withFixture(({ root }) => {
    writeFileSync(join(root, 'cordis.patch.yml'), '- remove: component-a\n')
    expect(validatePackLayout(root).errors).toContain(
      'aggregate patch operation 1 must contain only insert',
    )
  }))

  it('rejects mismatched aggregate ids', () => withFixture(({ root }) => {
    writeFileSync(join(root, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: wrong-id',
      '      name: component-a',
      '',
    ].join('\n'))
    expect(validatePackLayout(root).errors.some(error => error.startsWith('aggregate patch modules differ'))).toBe(true)
  }))

  it('rejects a component patch with a mismatched id', () => withFixture(({ root, component }) => {
    writeFileSync(join(component, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: wrong-id',
      '      name: component-a',
      '',
    ].join('\n'))
    expect(validatePackLayout(root).errors).toContain(
      'a: bundle patch must insert exactly component-a with matching id and name',
    )
  }))

  it('rejects duplicate manifest package values', () => withFixture(({ root }) => {
    writeJson(join(root, 'manifest.json'), {
      name: 'dsh-codex-pack',
      modules: { a: 'component-a', duplicate: 'component-a' },
      mountPointsDoc: 'docs/MOUNT_POINTS.md',
    })
    expect(validatePackLayout(root).errors).toContain(
      'duplicate: duplicate package name component-a',
    )
  }))
})
