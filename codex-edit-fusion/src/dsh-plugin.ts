/**
 * Model-facing single-target V4A patch tool over the DSH filesystem service.
 * @module codex-edit-fusion/dsh-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { parsePatch, applyPatch, type Patch } from './v4aParser.js'
import { seekSequence } from './seekSequence.js'

class MutationPolicy {
  private readonly policy: SandboxPolicyService | undefined

  constructor(ctx: Context) {
    this.policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (ctx.fs.sandboxMode !== undefined && this.policy === undefined) {
      throw new Error('codex-edit-fusion: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  resolve(exec: ToolRunContext): SandboxExecutionPolicy | undefined {
    return this.policy?.resolve({
      ...exec.agent === undefined ? {} : { session: exec.agent.session },
    })
  }

  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    const mode = (policy as SandboxExecutionPolicy).mode
    return new FsError(sandboxDenialMarker(mode), 'FS_SANDBOX_DENIED', { cause: error })
  }
}

interface AcceptedAdd {
  readonly kind: 'add'
  readonly path: string
  readonly content: string
}

interface AcceptedUpdate {
  readonly kind: 'update'
  readonly path: string
  readonly patch: Patch
}

type AcceptedPatch = AcceptedAdd | AcceptedUpdate

function acceptSingleTarget(patch: Patch): AcceptedPatch {
  const count = patch.addFiles.length + patch.updateFiles.length + patch.deleteFiles.length
  if (count !== 1) {
    throw new Error('codex_apply_patch accepts exactly one Add File or one Update File declaration')
  }
  if (patch.deleteFiles.length !== 0) {
    throw new Error('codex_apply_patch does not support Delete File declarations')
  }
  const add = patch.addFiles[0]
  if (add !== undefined) {
    return { kind: 'add', path: add.path, content: add.lines.join('\n') }
  }
  const update = patch.updateFiles[0]
  if (update === undefined) {
    throw new Error('codex_apply_patch requires one Add File or one Update File declaration')
  }
  if (update.moveTo !== undefined) {
    throw new Error('codex_apply_patch does not support Move to or Rename to directives')
  }
  return { kind: 'update', path: update.path, patch }
}

async function resolveTarget(ctx: Context, path: string, exec: ToolRunContext) {
  if (path.trim().length === 0) throw new Error('patch path must be a non-empty string')
  return ctx.fs.resolve(path, {
    ...exec.agent?.session.header.cwd === undefined
      ? {}
      : { cwd: exec.agent.session.header.cwd },
    signal: exec.signal,
  })
}

async function applyAcceptedPatch(
  ctx: Context,
  policy: MutationPolicy,
  accepted: AcceptedPatch,
  exec: ToolRunContext,
): Promise<string> {
  const sandboxPolicy = policy.resolve(exec)
  const target = await resolveTarget(ctx, accepted.path, exec)
  try {
    if (accepted.kind === 'add') {
      await ctx.fs.writeText(
        target,
        accepted.content,
        { kind: 'createIfAbsent' },
        exec.signal,
        sandboxPolicy,
      )
      return JSON.stringify({ applied: [{ file: accepted.path, status: 'applied' }], errors: [] })
    }

    const info = await ctx.fs.stat(target, exec.signal)
    if (info === undefined) {
      throw new FsError(`cannot update "${target.displayPath}": file does not exist`, 'FS_NOT_FOUND')
    }
    if (info.type !== 'file') {
      throw new FsError(`cannot update "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    const before = await ctx.fs.readText(target, exec.signal)
    const result = applyPatch(
      accepted.patch,
      new Map([[accepted.path, before]]),
      (lines, pattern, start, eof) =>
        seekSequence(lines, pattern, start, eof, 'NormalizeToLf'),
    )
    if (result.errors.length !== 0) throw new Error(result.errors.join('; '))
    const after = result.files.get(accepted.path)
    if (after === undefined) throw new Error(`patch removed its update target: ${accepted.path}`)
    await ctx.fs.writeText(
      target,
      after,
      { kind: 'replaceIfVersion', version: info.version },
      exec.signal,
      sandboxPolicy,
    )
    return JSON.stringify({ applied: result.results, errors: [] })
  } catch (error: unknown) {
    throw policy.mapError(error, sandboxPolicy)
  }
}

export const name = 'codex-edit-fusion'
export const inject = ['tools', 'fs']

/** Runtime configuration for the patch tool. */
export interface Config {}

/** The patch tool currently has no deployment knobs. */
export const Config: z<Config> = z.object({})

/** Register `codex_apply_patch` over the mounted DSH filesystem provider. */
export function apply(ctx: Context, _config: Config): void {
  const policy = new MutationPolicy(ctx)
  ctx.tools.register(defineTool({
    name: 'codex_apply_patch',
    description: [
      'Apply exactly one openai/codex V4A Add File or Update File patch.',
      'One Update File may contain multiple hunks. Delete, move, rename, and multi-file patches are rejected.',
      'Relative paths resolve from the current session workspace.',
    ].join(' '),
    parameters: {
      patch: {
        type: 'string',
        required: true,
        description: 'Complete V4A text from *** Begin Patch through *** End Patch.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const parsed = parsePatch(args.patch)
      const accepted = acceptSingleTarget(parsed)
      return applyAcceptedPatch(ctx, policy, accepted, exec)
    },
  }))
}

export { parsePatch, applyPatch, seekSequence }
