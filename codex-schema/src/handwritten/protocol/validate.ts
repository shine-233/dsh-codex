// Runtime validators for the protocol sketch (M1 → executable).
// Zero deps; guards mirror the sketch interfaces and the upstream
// protocol crate shapes at rust-v0.153.4. Tolerant of extra keys.
export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function union(
  j: unknown,
  tagKey: string,
  members: Record<string, (v: Record<string, unknown>) => string | null>,
): ValidationResult {
  if (!isObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j[tagKey]
  if (typeof tag !== 'string') return { ok: false, variant: null, error: `missing string \`${tagKey}\`` }
  const check = members[tag]
  if (!check) return { ok: false, variant: tag, error: `unknown variant: ${tag}` }
  const err = check(j)
  return err ? { ok: false, variant: tag, error: err } : { ok: true, variant: tag }
}

const isStr = (v: unknown): boolean => typeof v === 'string'
const isOptStr = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string'

// ── UserInput (turn_input.rs, serde tag = "type") ────────────────────────────

export function validateUserInput(j: unknown): ValidationResult {
  return union(j, 'type', {
    Text: (v) => (isStr(v.text) ? null : 'Text requires string `text`'),
    Image: (v) => (isStr(v.imageUrl) ? null : 'Image requires string `imageUrl`'),
    LocalImage: (v) => (v.path !== undefined ? null : 'LocalImage requires `path`'),
    Audio: (v) => (isStr(v.audioUrl) ? null : 'Audio requires string `audioUrl`'),
    LocalAudio: (v) => (v.path !== undefined ? null : 'LocalAudio requires `path`'),
    Skill: (v) => (isStr(v.name) && v.path !== undefined ? null : 'Skill requires `name` and `path`'),
    Mention: (v) => (isStr(v.name) && isStr(v.path) ? null : 'Mention requires strings `name` and `path`'),
  })
}

// ── ParsedCommand (shell-command analysis face) ─────────────────────────────

export function validateParsedCommand(j: unknown): ValidationResult {
  return union(j, 'type', {
    Read: (v) => (isStr(v.cmd) ? null : 'Read requires string `cmd`'),
    ListFiles: (v) => (isStr(v.cmd) && isOptStr(v.path) ? null : 'ListFiles requires `cmd` and optional `path`'),
    Search: (v) => (isStr(v.cmd) && isOptStr(v.query) && isOptStr(v.path) ? null : 'Search requires `cmd` + optional `query`/`path`'),
    Unknown: (v) => (isStr(v.cmd) ? null : 'Unknown requires string `cmd`'),
  })
}

// ── RawFileSystemPath (type-tagged) ─────────────────────────────────────────

export function validateRawFileSystemPath(j: unknown): ValidationResult {
  return union(j, 'type', {
    Path: () => null,
    GlobPattern: (v) => (isStr(v.pattern) ? null : 'GlobPattern requires string `pattern`'),
    Special: (v) => (v.value !== undefined ? null : 'Special requires `value`'),
  })
}

// ── EnvironmentConfigState (internally tagged via None-style sketches; 0.153.4) ──

const ENVIRONMENT_CONFIG_STATE_VARIANTS = ['Ready', 'Failed', 'FromThread', 'Pending']

export function validateEnvironmentConfigState(j: unknown): ValidationResult {
  if (!isObject(j)) return { ok: false, variant: null, error: 'not an object' }
  const tag = j.None
  if (typeof tag !== 'string' || !ENVIRONMENT_CONFIG_STATE_VARIANTS.includes(tag)) {
    return { ok: false, variant: null, error: `unknown EnvironmentConfigState variant: ${String(tag)}` }
  }
  // Ready carries an EnvironmentConfig payload upstream; the sketch does not
  // expand it, so only the tag is enforced here.
  return { ok: true, variant: tag }
}

// ── ReasoningEffort (openai_models.rs, 0.153.4 variant set) ─────────────────

export const REASONING_EFFORT_VARIANTS = [
  'None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra', 'Persistent',
] as const

export function validateReasoningEffort(j: unknown): ValidationResult {
  if (typeof j === 'string' && (REASONING_EFFORT_VARIANTS as readonly string[]).includes(j)) return { ok: true, variant: j }
  if (isObject(j) && typeof j.Custom === 'string') return { ok: true, variant: 'Custom' }
  return { ok: false, variant: null, error: 'unknown ReasoningEffort' }
}
