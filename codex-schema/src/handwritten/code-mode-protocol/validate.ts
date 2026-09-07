// Runtime validators for the code-mode-protocol sketch (M1 → executable).
// Guards mirror the sketch interfaces (upstream rust-v0.153.4).
// P2-2: payloads formalized as zod schemas; contract semantic-locked by tests.
import { zodUnion, sketchMember, presenceKeys, type ValidationResult } from '../zodUnion.js'

export interface ValidationResult { ok: boolean; variant: string | null; error?: string }

// ── WireContentItem (type-tagged) ───────────────────────────────────────────

const WIRE_CONTENT_ITEM_MEMBERS = {
  InputText: sketchMember({ strings: { text: 'InputText requires string `text`' } }),
  InputImage: sketchMember({ strings: { imageUrl: 'InputImage requires string `imageUrl`' } }),
  InputAudio: sketchMember({ strings: { audioUrl: 'InputAudio requires string `audioUrl`' } }),
}

export function validateWireContentItem(j: unknown): ValidationResult {
  return zodUnion(j, 'type', WIRE_CONTENT_ITEM_MEMBERS)
}

// ── WireRuntimeResponse (None-tagged; Yielded/Terminated share shape, Result adds error_text) ──

export function validateWireRuntimeResponse(j: unknown): ValidationResult {
  return zodUnion(j, 'None', {
    Yielded: presenceKeys('cell_id', 'content_items'),
    Terminated: presenceKeys('cell_id', 'content_items'),
    Result: presenceKeys('cell_id', 'content_items', 'error_text'),
  })
}

// ── RuntimeResponse (CellId + FunctionCallOutputContentItem face) ───────────

export function validateRuntimeResponse(j: unknown): ValidationResult {
  return zodUnion(j, 'None', {
    Yielded: presenceKeys('cell_id', 'content_items'),
    Terminated: presenceKeys('cell_id', 'content_items'),
    Result: presenceKeys('cell_id', 'content_items', 'error_text'),
  })
}

// ── WaitOutcome / WaitToPendingOutcome (None-tagged: LiveCell | MissingCell) ──

export function validateWaitOutcome(j: unknown): ValidationResult {
  return zodUnion(j, 'None', {
    LiveCell: sketchMember(),
    MissingCell: sketchMember(),
  })
}

export function validateWaitToPendingOutcome(j: unknown): ValidationResult {
  return zodUnion(j, 'None', {
    LiveCell: sketchMember(),
    MissingCell: sketchMember(),
  })
}

// ── ExecuteToPendingOutcome (None-tagged; Pending carries cell/work items) ──

export function validateExecuteToPendingOutcome(j: unknown): ValidationResult {
  return zodUnion(j, 'None', {
    Pending: presenceKeys('cell_id', 'content_items', 'pending_tool_call_ids'),
    Completed: sketchMember(),
  })
}

// ── FunctionCallOutputContentItem (code-mode face; type-tagged) ─────────────

export function validateFunctionCallOutputContentItem(j: unknown): ValidationResult {
  return zodUnion(j, 'type', {
    InputText: sketchMember({ strings: { text: 'InputText requires string `text`' } }),
    InputImage: sketchMember({ strings: { imageUrl: 'InputImage requires string `imageUrl`' } }),
    InputAudio: sketchMember({ strings: { audioUrl: 'InputAudio requires string `audioUrl`' } }),
  })
}
