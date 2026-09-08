import { describe, expect, it } from 'vitest'
import {
  issueApprovalEvidence,
  validateApprovalEvidence,
  type ApprovalEvidence,
} from '../src/approvalEvidence'

describe('approval evidence freshness', () => {
  it('accepts evidence for the same resource within its lifetime', () => {
    const evidence = issueApprovalEvidence({
      resourceFingerprint: 'sha256:abc',
      decision: 'Allow',
      issuedAt: 1_000,
      ttlMs: 5_000,
    })
    expect(validateApprovalEvidence(evidence, {
      resourceFingerprint: 'sha256:abc', decision: 'Allow', now: 4_000,
    })).toEqual({ ok: true })
  })

  it('rejects evidence after expiry and before its issued time', () => {
    const evidence = issueApprovalEvidence({
      resourceFingerprint: 'sha256:abc', decision: 'Allow', issuedAt: 1_000, ttlMs: 5_000,
    })
    expect(validateApprovalEvidence(evidence, {
      resourceFingerprint: 'sha256:abc', decision: 'Allow', now: 6_001,
    })).toEqual({ ok: false, reason: 'expired' })
    expect(validateApprovalEvidence(evidence, {
      resourceFingerprint: 'sha256:abc', decision: 'Allow', now: 999,
    })).toEqual({ ok: false, reason: 'not-yet-valid' })
  })

  it('rejects stale evidence when the resource or requested decision changes', () => {
    const evidence = issueApprovalEvidence({
      resourceFingerprint: 'sha256:abc', decision: 'Allow', issuedAt: 1_000, ttlMs: 5_000,
    })
    expect(validateApprovalEvidence(evidence, {
      resourceFingerprint: 'sha256:def', decision: 'Allow', now: 2_000,
    })).toEqual({ ok: false, reason: 'resource-mismatch' })
    expect(validateApprovalEvidence(evidence, {
      resourceFingerprint: 'sha256:abc', decision: 'Prompt', now: 2_000,
    })).toEqual({ ok: false, reason: 'decision-mismatch' })
  })

  it('rejects revoked evidence and malformed time windows', () => {
    const evidence = issueApprovalEvidence({
      resourceFingerprint: 'sha256:abc', decision: 'Allow', issuedAt: 1_000, ttlMs: 5_000,
    })
    const revoked: ApprovalEvidence = { ...evidence, revokedAt: 2_500 }
    expect(validateApprovalEvidence(revoked, {
      resourceFingerprint: 'sha256:abc', decision: 'Allow', now: 3_000,
    })).toEqual({ ok: false, reason: 'revoked' })
    expect(validateApprovalEvidence({ ...evidence, expiresAt: 500 }, {
      resourceFingerprint: 'sha256:abc', decision: 'Allow', now: 700,
    })).toEqual({ ok: false, reason: 'invalid-window' })
  })
})
