import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'

interface ToolDefinition {
  name: string
  execute?: (args: Record<string, unknown>) => Promise<string>
}

const expectedTools = [
  'codex_policy_check',
  'codex_command_safety_check',
  'codex_apply_patch',
  'codex_config_import',
  'codex_prompts',
  'codex_session_import',
  'codex_memory',
  'codex_net_guard',
  'codex_schema_info',
  'codex_skill_catalog',
  'codex_skill_select',
]

let context: Context | undefined
let fsRoot: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (fsRoot !== undefined) {
    rmSync(fsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    fsRoot = undefined
  }
})

describe('aggregate bundle through real Cordis Loader', () => {
  it('activates committed package exports and invokes a read-only tool', async () => {
    const definitions = new Map<string, ToolDefinition>()
    context = new Context()
    context.provide('tools', {
      register(definition: ToolDefinition) {
        if (definitions.has(definition.name)) throw new Error(`duplicate tool registration: ${definition.name}`)
        definitions.set(definition.name, definition)
        return () => {
          if (definitions.get(definition.name) === definition) definitions.delete(definition.name)
        }
      },
    })
    // `codex-edit-fusion` declares `inject = ['tools', 'fs']`, so the harness
    // must mount a real filesystem authority or the plugin never activates and
    // `codex_apply_patch` is silently absent. This is the real DSH local
    // filesystem, rooted in a temp dir — not a stub.
    fsRoot = mkdtempSync(join(tmpdir(), 'pack-loader-fs-'))
    await context.plugin(LocalFileSystem, { cwd: fsRoot })
    await context.plugin(Loader)
    const builtPackages = [
      'codex-policy-engine',
      'codex-edit-fusion',
      'codex-config-importer',
      'codex-prompts',
      'codex-session-kit',
      'codex-net-guard',
      'codex-schema',
      'codex-skills-kit',
    ] as const
    const imports = new Map<string, unknown>()
    for (const packageName of builtPackages) {
      const specifier = new URL(`../../${packageName}/lib/index.js`, import.meta.url).href
      imports.set(packageName, await import(/* @vite-ignore */ specifier))
    }
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!imports.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return imports.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    for (const packageName of imports.keys()) await context.loader.create({ name: packageName })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect([...definitions.keys()]).toEqual(expectedTools)

    const check = definitions.get('codex_policy_check')
    expect(check?.execute).toBeTypeOf('function')
    const result = JSON.parse(await check!.execute!({ command: 'git status' }))
    expect(result).toMatchObject({ command: 'git status', decision: 'Prompt' })
  })
})
