// dsh plugin entry for codex-policy-engine (ported from openai/codex execpolicy, Apache-2.0)
// Seam: ctx.on('tools/pre-execute') intercepts every tool call; we route
// bash/pwsh-style commands through the ported Policy engine.
import { Policy } from './policy.js';
import { prefixRule, altsToken, singleToken, type PatternToken } from './rule.js';
import { parsePolicyFile } from './starlarkLite.js';
import { dangerousCommandMatch, dangerousCommandMatchLine, type DangerousPlatform } from './commandSafety.js';
import { canonicalizeCommandForApproval } from './canonicalization.js';
import type { Decision, Evaluation } from './decision.js';

export const name = 'codex-policy-engine'
export const inject = ['tools']

type UnknownRecord = Record<string, unknown>
type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: string; text: string }[]
  }
  execute: (args: unknown) => Promise<string>
  timeoutMs: number
}
type ToolHost = { tools: { register: (tool: ToolDefinition) => unknown } }
type ToolExecution = { name?: unknown; arguments?: unknown }
type InterceptionResult = { kind: 'deny' | 'ask'; reason: string }
type Next = () => unknown
type EventHost = {
  on: (
    event: 'tools/pre-execute',
    handler: (exec: ToolExecution, next: Next) => unknown,
    options: { prepend: boolean },
  ) => unknown
}
type Host = Partial<ToolHost & EventHost>

type PolicyConfig = {
  mode?: 'off' | 'audit' | 'enforce'
  commandTools?: unknown[]
  commandSafety?: 'off' | 'audit' | 'enforce'
  commandSafetyPlatform?: DangerousPlatform
  rules?: unknown[]
}

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as UnknownRecord : {}
}

function hasToolHost(v: Host): v is Host & ToolHost {
  return typeof v.tools?.register === 'function'
}

/** Tokenize a command line the way shells roughly do (quote-aware). */
export function tokenizeCommand(line: unknown): string[] {
  if (typeof line !== 'string') return []
  const out: string[] = []; let cur = ''; let q: string | null = null
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue }
    if (ch === '"' || ch === "'") { q = ch; continue }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export function policyFromConfig(config: unknown = {}): Policy {
  const cfg = asRecord(config) as PolicyConfig
  const policy = new Policy()
  // YAML-friendly normalization: accept bare strings / arrays / PatternToken objects.
  const normToken = (t: unknown): PatternToken | null => {
    if (typeof t === 'string') return singleToken(t)
    if (Array.isArray(t)) return altsToken(t.map(String))
    const token = asRecord(t)
    if (token.kind === 'Single' || token.kind === 'Alts') return token as PatternToken
    return null
  }
  for (const r of Array.isArray(cfg.rules) ? cfg.rules : []) {
    const rule = asRecord(r)
    if (!rule.first || typeof rule.decision !== 'string') continue
    const rest: PatternToken[] = []
    for (const raw of Array.isArray(rule.rest) ? rule.rest : []) {
      const t = normToken(raw)
      if (t) rest.push(t)
    }
    policy.addPrefixRule({ first: String(rule.first), rest, decision: rule.decision as Decision })
  }
  return policy
}

/** Evaluate a raw command line against the configured policy. */
export function evaluate(policy: Policy, line: unknown): Evaluation {
  return policy.check(tokenizeCommand(line))
}

/** Evaluate with a canonical-key cache: `/bin/bash -lc X` and `bash -c X` share one entry. */
export function evaluateCached(policy: Policy, line: unknown, cache: Map<string, Evaluation>): Evaluation {
  const argv = tokenizeCommand(line)
  const key = canonicalizeCommandForApproval(argv).join('\u0000')
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const ev = policy.check(argv)
  cache?.set(key, ev)
  return ev
}

export function apply(ctx: Host, config: unknown = {}) {
  const cfg = asRecord(config) as PolicyConfig
  const mode = cfg.mode === 'enforce' || cfg.mode === 'audit' ? cfg.mode : 'off'
  const patterns = (Array.isArray(cfg.commandTools) && cfg.commandTools.length)
    ? cfg.commandTools.map(String)
    : ['bash', 'pwsh', '*-bash*', '*-pwsh*', 'shell', 'terminal*']

  const wildcard = (pattern: string, value: unknown): boolean => {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${esc}$`, 'i').test(String(value ?? ''))
  }
  const isCommandTool = (toolName: unknown): boolean => patterns.some((p: string) => wildcard(p, toolName))

  const policy = policyFromConfig(cfg)

  // Approval-decision cache keyed on the canonicalized command (unified_exec
  // idea: decisions stay stable and cheap across wrapper-path differences —
  // `/bin/bash -lc` vs `bash -lc` hit the same entry). NOTE: caching here is
  // evaluation memoization only; user-approval outcome memory needs an outcome
  // feedback seam dsh does not expose yet.
  const approvalCache = new Map<string, Evaluation>()

  // Optional read-only inspection tool (always available).
  try {
    if (hasToolHost(ctx)) {
      const defineTool = <T extends ToolDefinition>(d: T): T => d
      ctx.tools.register(defineTool({
        name: 'codex_policy_check',
        description: 'Evaluate a command line against the codex-policy-engine approval rules. Read-only.',
        parameters: {
          command: { type: 'string', required: true, description: 'raw command line to evaluate' },
        },
        output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] },
        async execute(args: unknown) {
          const input = asRecord(args)
          const ev = evaluate(policy, input.command)
          return JSON.stringify({ command: input.command, decision: ev.decision, matchedPrograms: ev.matchedPrograms })
        },
        timeoutMs: 3000,
      }))
      // Dangerous-command classifier (ported from shell-command command_safety @0.153.4). Read-only.
      const safetyPlatformDefault: DangerousPlatform = process.platform === 'win32' ? 'windows' : 'posix'
      ctx.tools.register(defineTool({
        name: 'codex_command_safety_check',
        description: 'Classify a command line with the ported openai/codex dangerous-command heuristics (forced rm, sudo/env/trap wrappers, sh -c literals, Windows ShellExecute/URL and force-delete patterns). Read-only.',
        parameters: {
          command: { type: 'string', required: true, description: 'raw command line to classify' },
        },
        output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] },
        async execute(args: unknown) {
          const input = asRecord(args)
          const argv = tokenizeCommand(input.command)
          const match = dangerousCommandMatch(argv, { platform: safetyPlatformDefault })
          return JSON.stringify({ command: input.command, platform: safetyPlatformDefault, match: match ?? null })
        },
        timeoutMs: 3000,
      }))
    }
  } catch { /* tool seam unavailable on this host */ }

  if (mode === 'off' || typeof ctx.on !== 'function') return

  ctx.on('tools/pre-execute', (exec: ToolExecution, next: Next): unknown | InterceptionResult => {
    if (!isCommandTool(exec?.name)) return next()
    const line = String(asRecord(exec?.arguments).command ?? '')
    if (!line.trim()) return next()

    // Shell-safety layer (opt-in via cfg.commandSafety: 'audit' | 'enforce').
    // Policy allow-rules never waive the dangerous-command classifier:
    // ForcedRm denies outright, other matches escalate to ask (audit logs-and-allows).
    const safetyMode = cfg.commandSafety === 'audit' || cfg.commandSafety === 'enforce'
      ? cfg.commandSafety : 'off'
    if (safetyMode !== 'off') {
      const safetyPlatform = cfg.commandSafetyPlatform === 'posix' || cfg.commandSafetyPlatform === 'windows'
        ? cfg.commandSafetyPlatform
        : (process.platform === 'win32' ? 'windows' : 'posix')
      const dangerous = dangerousCommandMatchLine(line, { platform: safetyPlatform })
      if (dangerous && safetyMode === 'enforce') {
        if (dangerous === 'ForcedRm') {
          return { kind: 'deny', reason: '[codex-policy-engine] forced removal rejected by command-safety classifier' }
        }
        return { kind: 'ask', reason: `[codex-policy-engine] command matches dangerous-command heuristics \`${line}\`` }
      }
    }

    const ev = evaluateCached(policy, line, approvalCache)
    if (ev.decision === 'Allow') return next()
    if (ev.decision === 'Forbidden') {
      return { kind: 'deny', reason: `[codex-policy-engine] forbidden by rule (matched: ${ev.matchedPrograms.join(', ') || 'none'})` }
    }
    // Prompt → audit mode logs-and-allows, enforce mode asks the user.
    if (mode === 'audit') return next()
    return { kind: 'ask', reason: `[codex-policy-engine] no allow rule matched \`${line}\`` }
  }, { prepend: true })
}

export { Policy, prefixRule, altsToken, parsePolicyFile }
