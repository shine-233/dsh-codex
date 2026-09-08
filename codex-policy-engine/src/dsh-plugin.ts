// dsh plugin entry for codex-policy-engine (ported from openai/codex execpolicy, Apache-2.0)
// Seam: ctx.on('tools/pre-execute') intercepts every tool call; we route
// bash/pwsh-style commands through the ported Policy engine.
import { Policy } from './policy.js';
import { prefixRule, altsToken, singleToken, type PatternToken } from './rule.js';
import { parsePolicyFile } from './starlarkLite.js';
import { dangerousCommandMatchLine } from './commandSafety.js';
import { canonicalizeCommandForApproval } from './canonicalization.js';
import type { Decision, Evaluation } from './decision.js';

type UnknownRecord = Record<string, unknown>
type MaybePromise<T> = T | Promise<T>
type Next = () => unknown

export interface ExtensionDecisionInput {
  callId: string
  rootCallId: string
  toolName: string
  arguments: unknown
  signal: AbortSignal
}
export type ExtensionDecision =
  | { kind: 'delegate' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
export interface ExtensionDecisionAdapter {
  decide(input: ExtensionDecisionInput): MaybePromise<ExtensionDecision>
}
export interface ExtensionRuntimeFeedback {
  callId: string
  rootCallId: string
  toolName: string
  result: Readonly<unknown>
}
export interface ExtensionRuntimeObserver {
  observe(feedback: ExtensionRuntimeFeedback): MaybePromise<void>
}

interface ToolExecution {
  callId?: unknown
  rootCallId?: unknown
  name?: unknown
  arguments?: unknown
  signal?: unknown
}
interface ToolDefinition {
  name: string
  description: string
  parameters: UnknownRecord
  output: { schema: UnknownRecord; render: (_args: unknown, value: string) => { type: 'text'; text: string }[] }
  execute: (args: UnknownRecord) => Promise<string>
  timeoutMs: number
}
interface DshContext {
  tools?: { register?: (tool: ToolDefinition) => void }
  on?: {
    (event: 'tools/pre-execute', listener: (exec: ToolExecution, next: Next) => unknown, options?: UnknownRecord): void
    (event: 'tools/result', listener: (exec: ToolExecution, result: Readonly<unknown>) => unknown): void
  }
}
interface ConfigRule { first?: unknown; decision?: unknown; rest?: unknown }
interface PluginConfig extends UnknownRecord {
  mode?: unknown
  commandTools?: unknown
  rules?: unknown
  commandSafety?: unknown
  commandSafetyPlatform?: unknown
  decisionAdapter?: unknown
  runtimeObserver?: unknown
}

export const name = 'codex-policy-engine'
export const inject = ['tools']

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as UnknownRecord : {}
}

function isDecision(value: unknown): value is Decision {
  return value === 'Allow' || value === 'Forbidden' || value === 'Prompt'
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return value instanceof AbortSignal
}

function isDecisionAdapter(value: unknown): value is ExtensionDecisionAdapter {
  return Boolean(value && typeof value === 'object' && typeof (value as UnknownRecord).decide === 'function')
}

function isRuntimeObserver(value: unknown): value is ExtensionRuntimeObserver {
  return Boolean(value && typeof value === 'object' && typeof (value as UnknownRecord).observe === 'function')
}

function decisionInput(exec: ToolExecution): ExtensionDecisionInput | null {
  if (typeof exec.callId !== 'string' || typeof exec.rootCallId !== 'string'
    || typeof exec.name !== 'string' || !isAbortSignal(exec.signal)) return null
  return {
    callId: exec.callId,
    rootCallId: exec.rootCallId,
    toolName: exec.name,
    arguments: exec.arguments,
    signal: exec.signal,
  }
}

function mapExtensionDecision(decision: ExtensionDecision, next: Next): unknown {
  switch (decision.kind) {
    case 'delegate': return next()
    case 'deny': return { kind: 'deny', reason: decision.reason }
    case 'ask': return decision.reason === undefined
      ? { kind: 'ask' }
      : { kind: 'ask', reason: decision.reason }
  }
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

export function policyFromConfig(config: PluginConfig = {}): Policy {
  const cfg = asRecord(config)
  const policy = new Policy()
  // YAML-friendly normalization: accept bare strings / arrays / PatternToken objects.
  const normToken = (t: unknown): PatternToken | null => {
    if (typeof t === 'string') return singleToken(t)
    if (Array.isArray(t)) return altsToken(t.map(String))
    if (t && typeof t === 'object') {
      const token = t as UnknownRecord
      if (token.kind === 'Single' && typeof token.value === 'string') return token as PatternToken
      if (token.kind === 'Alts' && Array.isArray(token.values)) {
        return altsToken(token.values.map(String))
      }
    }
    return null
  }
  for (const rawRule of Array.isArray(cfg.rules) ? cfg.rules : []) {
    const rule = asRecord(rawRule) as ConfigRule
    if (!rule.first || !isDecision(rule.decision)) continue
    const rest: PatternToken[] = []
    for (const raw of Array.isArray(rule.rest) ? rule.rest : []) {
      const t = normToken(raw)
      if (t) rest.push(t)
    }
    policy.addPrefixRule({ first: String(rule.first), rest, decision: rule.decision })
  }
  return policy
}

/** Evaluate a raw command line against the configured policy. */
export function evaluate(policy: Policy, line: unknown): Evaluation {
  return policy.check(tokenizeCommand(line))
}

/** Evaluate with a canonical-key cache: `/bin/bash -lc X` and `bash -c X` share one entry. */
export function evaluateCached(policy: Policy, line: unknown, cache?: Map<string, Evaluation>): Evaluation {
  const argv = tokenizeCommand(line)
  const key = canonicalizeCommandForApproval(argv).join('\u0000')
  if (cache?.has(key)) return cache.get(key)!
  const ev = policy.check(argv)
  cache?.set(key, ev)
  return ev
}

export function apply(ctx: DshContext, config: PluginConfig = {}): void {
  const cfg = asRecord(config) as PluginConfig
  const mode = cfg.mode === 'enforce' || cfg.mode === 'audit' ? cfg.mode : 'off'
  const patterns = (Array.isArray(cfg.commandTools) && cfg.commandTools.length)
    ? cfg.commandTools.map(String)
    : ['bash', 'pwsh', '*-bash*', '*-pwsh*', 'shell', 'terminal*']

  const wildcard = (pattern: string, value: unknown): boolean => {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${esc}$`, 'i').test(String(value ?? ''))
  }
  const isCommandTool = (toolName: unknown): boolean => patterns.some((p) => wildcard(p, toolName))
  const decisionAdapter = isDecisionAdapter(cfg.decisionAdapter) ? cfg.decisionAdapter : undefined
  const runtimeObserver = isRuntimeObserver(cfg.runtimeObserver) ? cfg.runtimeObserver : undefined

  const policy = policyFromConfig(cfg)

  // Static policy-evaluation cache keyed on the canonicalized command. This
  // memoizes Policy.check() only; per-call user approval (including
  // allowed-once) still belongs to dsh's approval seam and is never cached.
  const approvalCache = new Map<string, Evaluation>()

  // Optional read-only inspection tool (always available).
  try {
    if (ctx?.tools?.register) {
      const defineTool = (definition: ToolDefinition): ToolDefinition => definition
      ctx.tools.register(defineTool({
        name: 'codex_policy_check',
        description: 'Evaluate a command line against the codex-policy-engine approval rules. Read-only.',
        parameters: {
          command: { type: 'string', required: true, description: 'raw command line to evaluate' },
        },
        output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
        async execute(args: UnknownRecord) {
          const ev = evaluate(policy, String(args?.command ?? ''))
          return JSON.stringify({ command: args?.command, decision: ev.decision, matchedPrograms: ev.matchedPrograms })
        },
        timeoutMs: 3000,
      }))
      // Dangerous-command classifier (ported from shell-command command_safety @0.153.4). Read-only.
      const safetyPlatformDefault = process.platform === 'win32' ? 'windows' : 'posix'
      ctx.tools.register(defineTool({
        name: 'codex_command_safety_check',
        description: 'Classify a command line with the ported openai/codex dangerous-command heuristics (forced rm, sudo/env/trap wrappers, sh -c literals, Windows ShellExecute/URL and force-delete patterns). Read-only.',
        parameters: {
          command: { type: 'string', required: true, description: 'raw command line to classify' },
        },
        output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
        async execute(args: UnknownRecord) {
          const command = String(args?.command ?? '')
          const match = dangerousCommandMatchLine(command, { platform: safetyPlatformDefault })
          return JSON.stringify({ command: args?.command, platform: safetyPlatformDefault, match: match ?? null })
        },
        timeoutMs: 3000,
      }))
    }
  } catch { /* tool seam unavailable on this host */ }

  if (typeof ctx?.on !== 'function') return

  if (runtimeObserver) {
    ctx.on('tools/result', (exec, result) => {
      if (typeof exec.callId !== 'string' || typeof exec.rootCallId !== 'string'
        || typeof exec.name !== 'string') return
      void Promise.resolve(runtimeObserver.observe({
        callId: exec.callId,
        rootCallId: exec.rootCallId,
        toolName: exec.name,
        result,
      })).catch(() => undefined)
    })
  }

  if (mode === 'off' && !decisionAdapter) return

  ctx.on('tools/pre-execute', (exec, next) => {
    if (decisionAdapter) {
      const input = decisionInput(exec)
      if (!input) {
        return { kind: 'deny', reason: '[codex-policy-engine] extension decision requires callId, rootCallId, toolName, and AbortSignal' }
      }
      if (input.signal.aborted) {
        return { kind: 'deny', reason: '[codex-policy-engine] extension decision cancelled before evaluation' }
      }
      return Promise.resolve()
        .then(() => decisionAdapter.decide(input))
        .then((decision) => mapExtensionDecision(decision, next))
        .catch((error: unknown) => ({
          kind: 'deny',
          reason: `[codex-policy-engine] extension decision failed closed: ${error instanceof Error ? error.message : String(error)}`,
        }))
    }
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
