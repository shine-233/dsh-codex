import type { Decision } from './decision.js'

/** An approval outcome bound to the exact resource and decision it covered. */
export interface ApprovalEvidence {
  resourceFingerprint: string
  decision: Decision
  issuedAt: number
  expiresAt: number
  revokedAt?: number
}

export interface ApprovalEvidenceInput {
  resourceFingerprint: string
  decision: Decision
  issuedAt: number
  ttlMs: number
}

export type ApprovalEvidenceInvalidReason =
  | 'invalid-window'
  | 'revoked'
  | 'not-yet-valid'
  | 'resource-mismatch'
  | 'decision-mismatch'
  | 'expired'

export type ApprovalEvidenceValidation =
  | { ok: true }
  | { ok: false; reason: ApprovalEvidenceInvalidReason }

/** Create immutable-by-convention evidence; callers should persist the returned value as-is. */
export function issueApprovalEvidence(input: ApprovalEvidenceInput): ApprovalEvidence {
  if (!Number.isFinite(input.issuedAt) || !Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new RangeError('issuedAt and ttlMs must be finite, with ttlMs > 0')
  }
  if (!input.resourceFingerprint) throw new TypeError('resourceFingerprint is required')
  return {
    resourceFingerprint: input.resourceFingerprint,
    decision: input.decision,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlMs,
  }
}

/** Validate that approval evidence is still safe to use for the requested operation. */
export function validateApprovalEvidence(
  evidence: ApprovalEvidence,
  request: { resourceFingerprint: string; decision: Decision; now: number },
): ApprovalEvidenceValidation {
  if (!Number.isFinite(evidence.issuedAt) || !Number.isFinite(evidence.expiresAt)
    || evidence.expiresAt <= evidence.issuedAt) return { ok: false, reason: 'invalid-window' }
  if (evidence.revokedAt !== undefined && (!Number.isFinite(evidence.revokedAt)
    || evidence.revokedAt < evidence.issuedAt)) return { ok: false, reason: 'invalid-window' }
  if (evidence.revokedAt !== undefined && request.now >= evidence.revokedAt) return { ok: false, reason: 'revoked' }
  if (request.now < evidence.issuedAt) return { ok: false, reason: 'not-yet-valid' }
  if (evidence.resourceFingerprint !== request.resourceFingerprint) return { ok: false, reason: 'resource-mismatch' }
  if (evidence.decision !== request.decision) return { ok: false, reason: 'decision-mismatch' }
  if (request.now >= evidence.expiresAt) return { ok: false, reason: 'expired' }
  return { ok: true }
}
