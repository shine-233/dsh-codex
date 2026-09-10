import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as CodexEditFusion from '../src/dsh-plugin.js'

const contexts: Context[] = []
const roots: string[] = []
let callNumber = 0

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function owner(ctx: Context, cwd: string): Agent {
  const id = SessionId(`codex-edit-owner-${++callNumber}`)
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    cwd,
    isSeeded: false,
  })
  const scope = ctx.plugin(() => {})
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, {
      inserted: () => {},
      discarded: () => {},
      claimed: () => {},
    }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

function patch(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

function call(
  ctx: Context,
  agent: Agent | undefined,
  source: string,
  signal = new AbortController().signal,
) {
  return ctx.tools.execute({
    callId: ToolCallId(`codex-edit-${++callNumber}`),
    name: 'codex_apply_patch',
    arguments: { patch: source },
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function bootThroughLoader() {
  const root = await mkdtemp(join(tmpdir(), 'codex-edit-loader-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(root.replaceAll('\\', '/'))}`,
    "- name: 'codex-edit-fusion'",
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['codex-edit-fusion', CodexEditFusion],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, root }
}

async function setup(mode?: 'read-only' | 'workspace-write' | 'danger-full-access') {
  const root = await mkdtemp(join(tmpdir(), 'codex-edit-fusion-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (mode === undefined) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
  } else {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SandboxPolicy, { mode, workspaceRoot: root })
    await ctx.plugin(SandboxedFileSystem, { cwd: root })
  }
  const fiber = await ctx.plugin(CodexEditFusion, {})
  return { ctx, root, fiber, agent: owner(ctx, root) }
}

describe('codex_apply_patch over the DSH filesystem service', () => {
  it('loads through real Loader/Include cordis.yml composition', async () => {
    const { ctx, root } = await bootThroughLoader()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['codex_apply_patch'])
    const result = await call(ctx, owner(ctx, root), patch('*** Add File: loader.txt', '+loaded'))
    expect(result.isError).toBe(false)
    expect(await readFile(join(root, 'loader.txt'), 'utf8')).toBe('loaded')
  })

  it('fails startup when a confining filesystem has no sandbox-policy service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-edit-misconfigured-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    Object.defineProperty(ctx.fs, 'sandboxMode', { configurable: true, value: 'read-only' })

    await expect(ctx.plugin(CodexEditFusion, {})).rejects.toThrow(
      'codex-edit-fusion: the mounted filesystem confines but ctx.sandboxPolicy is missing',
    )
    expect(ctx.tools.get('codex_apply_patch')).toBeUndefined()
  })

  it('registers one patch-only schema and unregisters on disposal', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['codex_apply_patch'])
    const properties = (ctx.tools.schemas()[0]?.parameters as {
      properties: Record<string, unknown>
    }).properties
    expect(Object.keys(properties)).toEqual(['patch'])
    await fiber.dispose()
    expect(ctx.tools.get('codex_apply_patch')).toBeUndefined()
  })

  it('creates one file with createIfAbsent semantics', async () => {
    const { ctx, root, agent } = await setup()
    const source = patch('*** Add File: added.txt', '+one', '+two')
    const result = await call(ctx, agent, source)
    expect(result.isError).toBe(false)
    expect(await readFile(join(root, 'added.txt'), 'utf8')).toBe('one\ntwo')

    const collision = await call(ctx, agent, source)
    expect(collision.isError).toBe(true)
    expect(collision.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(await readFile(join(root, 'added.txt'), 'utf8')).toBe('one\ntwo')
  })

  it('applies multiple hunks to one file with one guarded publication', async () => {
    const { ctx, root, agent } = await setup()
    await writeFile(join(root, 'sample.txt'), 'alpha\nbeta\ngamma\ndelta\n')
    const write = vi.spyOn(ctx.fs, 'writeText')
    const result = await call(ctx, agent, patch(
      '*** Update File: sample.txt',
      '@@', '-alpha', '+ALPHA',
      '@@', '-delta', '+DELTA',
    ))
    expect(result.isError).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[2]).toMatchObject({ kind: 'replaceIfVersion' })
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('ALPHA\nbeta\ngamma\nDELTA\n')
  })

  it.each([
    ['delete', patch('*** Delete File: a.txt')],
    ['move', patch('*** Update File: a.txt', '*** Move to: b.txt', '@@', '-a', '+b')],
    ['two adds', patch('*** Add File: a.txt', '+a', '*** Add File: b.txt', '+b')],
    ['mixed', patch('*** Add File: a.txt', '+a', '*** Update File: b.txt', '@@', '-b', '+c')],
  ])('rejects %s before filesystem resolution', async (_label, source) => {
    const { ctx, agent } = await setup()
    const resolve = vi.spyOn(ctx.fs, 'resolve')
    const result = await call(ctx, agent, source)
    expect(result.isError).toBe(true)
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    ['missing file', 'missing.txt', 'FS_NOT_FOUND'],
    ['directory', '.', 'FS_NOT_REGULAR_FILE'],
  ])('rejects an update of a %s without publication', async (_label, path, code) => {
    const { ctx, root, agent } = await setup()
    if (path === '.') await mkdir(join(root, 'directory-marker'))
    const write = vi.spyOn(ctx.fs, 'writeText')
    const result = await call(ctx, agent, patch(
      `*** Update File: ${path}`, '@@', '-before', '+after',
    ))
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code } })
    expect(write).not.toHaveBeenCalled()
  })

  it('reports a failed hunk as a tool error without mutation', async () => {
    const { ctx, root, agent } = await setup()
    const file = join(root, 'sample.txt')
    await writeFile(file, 'actual\n')
    const result = await call(ctx, agent, patch(
      '*** Update File: sample.txt', '@@', '-missing', '+replacement',
    ))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('hunk not found')
    expect(await readFile(file, 'utf8')).toBe('actual\n')
  })

  it('resolves a relative patch path from the immutable session cwd', async () => {
    const { ctx, root } = await setup()
    const sessionRoot = await mkdtemp(join(tmpdir(), 'codex-edit-session-'))
    roots.push(sessionRoot)
    const result = await call(ctx, owner(ctx, sessionRoot), patch(
      '*** Add File: session.txt', '+session-owned',
    ))
    expect(result.isError).toBe(false)
    expect(await readFile(join(sessionRoot, 'session.txt'), 'utf8')).toBe('session-owned')
    await expect(readFile(join(root, 'session.txt'), 'utf8')).rejects.toThrow()
  })

  it.each(['read-only', 'workspace-write'] as const)(
    'maps %s sandbox denials to the shared marker',
    async (mode) => {
      const { ctx, root } = await setup(mode)
      const cwd = mode === 'read-only' ? root : join(root, 'session-workspace')
      const deniedPath = mode === 'read-only'
        ? join(root, 'denied.txt')
        : join(process.cwd(), 'README.md')
      const before = mode === 'read-only' ? undefined : await readFile(deniedPath, 'utf8')
      const target = mode === 'read-only'
        ? 'denied.txt'
        : deniedPath.replaceAll('\\', '/')
      const result = await call(ctx, owner(ctx, cwd), patch(
        `*** Add File: ${target}`, '+denied',
      ))
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_SANDBOX_DENIED' } })
      expect(text(result)).toContain(`[sandbox: file access denied under ${mode} mode]`)
      if (before === undefined) {
        await expect(readFile(deniedPath, 'utf8')).rejects.toThrow()
      } else {
        expect(await readFile(deniedPath, 'utf8')).toBe(before)
      }
    },
  )

  it('preserves a competing update when guarded publication finds a stale version', async () => {
    const { ctx, root, agent } = await setup()
    const file = join(root, 'sample.txt')
    await writeFile(file, 'before\n')
    const publish = ctx.fs.writeText.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'writeText').mockImplementationOnce(async (...args) => {
      await writeFile(file, 'competitor\n')
      return publish(...args)
    })

    const result = await call(ctx, agent, patch(
      '*** Update File: sample.txt', '@@', '-before', '+tool',
    ))

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    expect(await readFile(file, 'utf8')).toBe('competitor\n')
  })

  it('honors cancellation after preparation and before publication', async () => {
    const { ctx, root, agent } = await setup()
    const file = join(root, 'sample.txt')
    await writeFile(file, 'before\n')
    const controller = new AbortController()
    const publish = ctx.fs.writeText.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'writeText').mockImplementationOnce(async (...args) => {
      controller.abort()
      return publish(...args)
    })

    const result = await call(ctx, agent, patch(
      '*** Update File: sample.txt', '@@', '-before', '+tool',
    ), controller.signal)

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_ABORTED' } })
    expect(await readFile(file, 'utf8')).toBe('before\n')
  })

  it('rejects a pre-aborted call without mutation', async () => {
    const { ctx, root, agent } = await setup()
    const controller = new AbortController()
    controller.abort()
    const result = await call(ctx, agent, patch('*** Add File: no.txt', '+no'), controller.signal)
    expect(result.isError).toBe(true)
    await expect(readFile(join(root, 'no.txt'), 'utf8')).rejects.toThrow()
  })
})
