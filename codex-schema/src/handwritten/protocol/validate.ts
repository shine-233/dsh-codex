// Runtime validators for the protocol sketch (M1 → executable).
// Guards mirror the sketch interfaces and the upstream protocol crate shapes
// at rust-v0.153.4. Tolerant of extra keys.
// P2-2: per-variant payloads are zod schemas dispatched by the shared
// sketch-union adapter (ok/variant/error contract semantic-locked by tests).
import { z } from 'zod'
import { zodUnion, sketchMember, zodNoneTagged } from '../zodUnion.js'

export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

// ── UserInput (turn_input.rs, serde tag = "type") ────────────────────────────

export function validateUserInput(j: unknown): ValidationResult {
  return zodUnion(j, 'type', {
    Text: sketchMember({ strings: { text: 'Text requires string `text`' } }),
    Image: sketchMember({ strings: { imageUrl: 'Image requires string `imageUrl`' } }),
    LocalImage: sketchMember({ definedKeys: ['path'] }),
    Audio: sketchMember({ strings: { audioUrl: 'Audio requires string `audioUrl`' } }),
    LocalAudio: sketchMember({ definedKeys: ['path'] }),
    Skill: sketchMember({ strings: { name: 'Skill requires `name` and `path`' }, definedKeys: ['path'] }),
    Mention: sketchMember({ strings: { name: 'Mention requires strings `name` and `path`', path: 'Mention requires strings `name` and `path`' } }),
  })
}

// ── ParsedCommand (shell-command analysis face) ─────────────────────────────

export function validateParsedCommand(j: unknown): ValidationResult {
  return zodUnion(j, 'type', {
    Read: sketchMember({ strings: { cmd: 'Read requires string `cmd`' } }),
    ListFiles: sketchMember({ strings: { cmd: 'ListFiles requires `cmd` and optional `path`' }, optionalStrings: ['path'] }),
    Search: sketchMember({ strings: { cmd: 'Search requires `cmd` + optional `query`/`path`' }, optionalStrings: ['query', 'path'] }),
    Unknown: sketchMember({ strings: { cmd: 'Unknown requires string `cmd`' } }),
  })
}

// ── RawFileSystemPath (type-tagged) ─────────────────────────────────────────

export function validateRawFileSystemPath(j: unknown): ValidationResult {
  return zodUnion(j, 'type', {
    Path: sketchMember(),
    GlobPattern: sketchMember({ strings: { pattern: 'GlobPattern requires string `pattern`' } }),
    Special: sketchMember({ definedKeys: ['value'] }),
  })
}

// ── EnvironmentConfigState (internally tagged via None-style sketches; 0.153.4) ──

const ENVIRONMENT_CONFIG_STATE_VARIANTS = ['Ready', 'Failed', 'FromThread', 'Pending']

export function validateEnvironmentConfigState(j: unknown): ValidationResult {
  // Ready carries an EnvironmentConfig payload upstream; the sketch does not
  // expand it, so only the tag is enforced here.
  return zodNoneTagged(j, ENVIRONMENT_CONFIG_STATE_VARIANTS, 'unknown EnvironmentConfigState variant')
}

// ── ReasoningEffort (openai_models.rs, 0.153.4 variant set) ─────────────────

export const REASONING_EFFORT_VARIANTS = [
  'None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra', 'Persistent',
] as const

const ReasoningEffortSchema = z.union([
  z.enum(REASONING_EFFORT_VARIANTS),
  z.object({ Custom: z.string() }).passthrough(),
])

export function validateReasoningEffort(j: unknown): ValidationResult {
  const r = ReasoningEffortSchema.safeParse(j)
  if (!r.success) return { ok: false, variant: null, error: 'unknown ReasoningEffort' }
  return typeof j === 'string'
    ? { ok: true, variant: j }
    : { ok: true, variant: 'Custom' }
}
