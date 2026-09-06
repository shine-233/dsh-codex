import { describe, it, expect } from 'vitest';
import { parseRolloutText, toDshEvents } from '../src/index';

/**
 * Upstream rust-v0.153.4 added two RolloutItem variants
 * (TokenUsageRecord, RealtimeItem — see codex-schema handwritten/history).
 * The tolerant parser must accept them without tripping badLines and without
 * mistaking them for the session header.
 */
describe('rollout tolerance for 0.153.4 RolloutItem variants', () => {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'sess-1', cwd: 'C:/w', originator: 'codex' } }),
    JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 't1', turn_id: 'turn-1', session_id: 'sess-1', root_turn_id: 'rt', response_id: 'resp-1', usage: { input_tokens: 10 }, turn_token_usage: {}, thread_token_usage: {} } }),
    JSON.stringify({ type: 'realtime_item', payload: { id: 'rt-1', realtime_session_id: 'rs-1', content: { type: 'realtime_session_started' } } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] } }),
    'not-json-garbage',
  ];

  it('parses new variants as items without failing bad-line accounting', () => {
    const parsed = parseRolloutText(lines.join('\n'));
    expect(parsed.header?.type).toBe('session_meta');
    expect(parsed.badLines).toBe(1);
    expect(parsed.items.map((i: any) => i.type)).toEqual([
      'token_usage_record',
      'realtime_item',
      'response_item',
    ]);
  });

  it('event normalization survives the new variants', () => {
    const parsed = parseRolloutText(lines.join('\n'));
    const events = toDshEvents(parsed.items);
    expect(events).toHaveLength(3);
    expect(events.every((e: any) => typeof e.type === 'string')).toBe(true);
    expect(events.map((e: any) => e.type)).toEqual([
      'token_usage_record',
      'realtime_item',
      'response_item',
    ]);
  });
});
