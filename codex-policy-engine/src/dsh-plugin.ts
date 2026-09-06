// dsh plugin entry for codex-policy-engine (ported from openai/codex execpolicy, Apache-2.0)
// Seam: ctx.on('tools/pre-execute') intercepts every tool call; we route
// bash/pwsh-style commands through the ported Policy engine.
import { Policy } from './policy.js';
import { prefixRule, altsToken, singleToken } from './rule.js';
import { parsePolicyFile } from './starlarkLite.js';
import { dangerousCommandMatchLine } from './commandSafety.js';
import { canonicalizeCommandForApproval } from './canonicalization.js';

export const name = 'codex-policy-engine'
export const inject = ['tools']

function asRecord(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {} }

/** Tokenize a command line the way shells roughly do (quote-aware). */
export function tokenizeCommand(line) {
  if (typeof line !== 'string') return []
  const out = []; let cur = ''; let q = null
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue }
    if (ch === '"' || ch === "'") { q = ch; continue }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export function policyFromConfig(config = {}) {
  const cfg = asRecord(config)
  const policy = new Policy()
  // YAML-friendly normalization: accept bare strings / arrays / PatternToken objects.
  const normToken = (t) => {
    if (typeof t === 'string') return singleToken(t)
    if (Array.isArray(t)) return altsToken(t.map(String))
    if (t && typeof t === 'object' && (t.kind === 'Single' || t.kind === 'Alts')) return t
    return null
  }
  for (const r of Array.isArray(cfg.rules) ? cfg.rules : []) {
    const rule = asRecord(r)
    if (!rule.first || typeof rule.decision !== 'string') continue
    const rest = []
    for (const raw of Array.isArray(rule.rest) ? rule.rest : []) {
      const t = normToken(raw)
      if (t) rest.push(t)
    }
    policy.addPrefixRule({ first: String(rule.first), rest, decision: rule.decision })
  }
  return policy
}

/** Evaluate a raw command line against the configured policy. */
export function evaluate(policy, line) {
  return policy.check(tokenizeCommand(line))
}

/** Evaluate with a canonical-key cache: `/bin/bash -lc X` and `bash -c X` share one entry. */
export function evaluateCached(policy, line, cache) {
  const argv = tokenizeCommand(line)
  const key = canonicalizeCommandForApproval(argv).join('\u0000')
  if (cache?.has(key)) return cache.get(key)
  const ev = policy.check(argv)
  cache?.set(key, ev)
  return ev
}

export function apply(ctx, config = {}) {
  const cfg = asRecord(config)
  const mode = cfg.mode === 'enforce' || cfg.mode === 'audit' ? cfg.mode : 'off'
  const patterns = (Array.isArray(cfg.commandTools) && cfg.commandTools.length)
    ? cfg.commandTools.map(String)
    : ['bash', 'pwsh', '*-bash*', '*-pwsh*', 'shell', 'terminal*']

  const wildcard = (pattern, value) => {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${esc}$`, 'i').test(String(value ?? ''))
  }
  const isCommandTool = (toolName) => patterns.some((p) => wildcard(p, toolName))

  let policy = policyFromConfig(cfg)

  // Approval-decision cache keyed on the canonicalized command (unified_exec
  // idea: decisions stay stable and cheap across wrapper-path differences —
  // `/bin/bash -lc` vs `bash -lc` hit the same entry). NOTE: caching here is
  // evaluation memoization only; user-approval outcome memory needs an outcome
  // feedback seam dsh does not expose yet.
  const approvalCache = new Map()

  // Optional read-only inspection tool (always available).
  try {
    if (ctx?.tools?.register) {
      const defineTool = (d) => d
      ctx.tools.register(defineTool({
        name: 'codex_policy_check',
        description: 'Evaluate a command line against the codex-policy-engine approval rules. Read-only.',
        parameters: {
          command: { type: 'string', required: true, description: 'raw command line to evaluate' },
        },
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
        async execute(args) {
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
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
        async execute(args) {
          const argv = tokenizeCommand(String(args?.command ?? ''))
          const match = dangerousCommandMatch(argv, { platform: safetyPlatformDefault })
          return JSON.stringify({ command: args?.command, platform: safetyPlatformDefault, match: match ?? null })
        },
        timeoutMs: 3000,
      }))
    }
  } catch { /* tool seam unavailable on this host */ }

  if (mode === 'off' || typeof ctx?.on !== 'function') return

  ctx.on('tools/pre-execute', (exec, next) => {
    if (!isCommandTool(exec?.name)) return next()
    const argv0 = String(exec?.name ?? '')
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

    const ev = evaluateCached(policy, line)
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
