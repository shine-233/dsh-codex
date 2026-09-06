import { describe, it, expect } from 'vitest';
import { validateRolloutItem } from '../src/handwritten/history/validate';

describe('history RolloutItem runtime validation (M1 → executable)', () => {
  it('accepts known variants with payload', () => {
    expect(validateRolloutItem({ type: 'session_meta', payload: { id: 's' } }).ok).toBe(true);
    expect(validateRolloutItem({ type: 'response_item', payload: {} }).type).toBe('response_item');
    expect(validateRolloutItem({ type: 'token_usage_record', payload: { usage: {} } }).type).toBe('token_usage_record');
    expect(validateRolloutItem({ type: 'realtime_item', payload: { id: 'r' } }).type).toBe('realtime_item');
  });
  it('session_meta does not require a payload member', () => {
    expect(validateRolloutItem({ type: 'session_meta' }).ok).toBe(true);
  });
  it('rejects unknown types and malformed envelopes', () => {
    expect(validateRolloutItem({ type: 'mystery_kind', payload: {} }).ok).toBe(false);
    expect(validateRolloutItem('not-an-object').ok).toBe(false);
    expect(validateRolloutItem({ payload: {} }).ok).toBe(false);
    expect(validateRolloutItem({ type: 'token_usage_record' }).ok).toBe(false);
  });
});
