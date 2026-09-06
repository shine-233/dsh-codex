import { describe, it, expect } from 'vitest';
import {
  approxTokenCount,
  truncateMiddleChars,
  truncateMiddleWithTokenBudget as truncateMiddleWithToken,
  truncateText,
  truncateFunctionOutputItems,
  formattedTruncateText,
} from '../src/outputTruncation';

describe('outputTruncation (ported from utils/output-truncation + utils/string, rust-v0.153.4)', () => {
  it('leaves short content untouched', () => {
    expect(truncateMiddleChars('hello', 100)).toBe('hello');
    expect(truncateText('hello', { kind: 'tokens', budget: 100 })).toBe('hello');
  });
  it('truncates the middle with a chars marker, preserving head and tail', () => {
    const long = 'A'.repeat(50) + 'MIDDLE' + 'B'.repeat(50);
    const out = truncateMiddleChars(long, 40);
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('B')).toBe(true);
    expect(out).toMatch(/…\d+ chars truncated…/);
  });
  it('token policy reports approximate token accounting', () => {
    expect(approxTokenCount('x'.repeat(40))).toBe(10);
    const [out, original] = truncateMiddleWithToken('x'.repeat(400), 20);
    expect(original).not.toBeNull();
    expect(out).toMatch(/tokens truncated/);
  });  it('formatted truncation warns with the original token count', () => {
    const out = formattedTruncateText('y'.repeat(500), { kind: 'bytes', budget: 100 });
    expect(out.startsWith('Warning: truncated output')).toBe(true);
    expect(out).toContain('Total output lines: 1');
  });
  it('skips empty text items (0.153.4 change)', () => {
    const items = [
      { type: 'input_text', text: '' },
      { type: 'input_text', text: 'kept' },
    ];
    const out = truncateFunctionOutputItems(items as any, { kind: 'bytes', budget: 1000 });
    expect(out).toHaveLength(1);
    expect((out[0] as any).text).toBe('kept');
  });
  it('omits text items once the budget is exhausted and appends a counter', () => {
    const items = [
      { type: 'input_text', text: 'first' },
      { type: 'input_text', text: 'second' },
      { type: 'input_text', text: 'third' },
    ];
    const out = truncateFunctionOutputItems(items as any, { kind: 'bytes', budget: 6 });
    const texts = out.map((i) => (i as any).text);
    expect(texts[0]).toBe('first');
    expect(texts.some((t: string) => t.includes('[omitted'))).toBe(true);
  });
  it('passes images through and omits over-budget audio with a counter', () => {
    const items = [
      { type: 'input_image', imageUrl: 'data:image/png;base64,xxx' },
      { type: 'input_audio', audioUrl: 'data:audio/wav;base64,yyy' },
    ];
    const out = truncateFunctionOutputItems(items as any, { kind: 'bytes', budget: 10 }, () => 500);
    expect(out.some((i) => i.type === 'input_image')).toBe(true);
    expect(out.some((i) => (i as any).text?.includes('[omitted 1 audio items'))).toBe(true);
  });
});
