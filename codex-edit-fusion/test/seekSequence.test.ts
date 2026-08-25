import { describe, it, expect } from 'vitest';
import { seekSequence } from '../src/index';

const v = (xs: string[]) => xs.slice();
const mode = 'NormalizeToLf' as const;

describe('seekSequence (ported from seek_sequence.rs)', () => {
  it('exact match finds sequence', () => {
    expect(seekSequence(v(['foo','bar','baz']), v(['bar','baz']), 0, false, mode)).toBe(1);
  });
  it('rstrip match ignores trailing whitespace', () => {
    expect(seekSequence(v(['foo   ','bar\t\t']), v(['foo','bar']), 0, false, mode)).toBe(0);
  });
  it('trim match ignores leading and trailing whitespace', () => {
    expect(seekSequence(v(['    foo   ','   bar\t']), v(['foo','bar']), 0, false, mode)).toBe(0);
  });
  it('pattern longer than input returns null without panic', () => {
    expect(seekSequence(v(['just one line']), v(['too','many','lines']), 0, false, mode)).toBeNull();
  });
  it('empty pattern is a no-op match at start', () => {
    expect(seekSequence(v(['x']), [], 0, false, mode)).toBe(0);
  });
  it('unicode punctuation normalisation pass', () => {
    const file = v(['value = \u201Ctest\u201D', 'other \u2014 thing']);
    const patch = v(['value = "test"', 'other - thing']);
    expect(seekSequence(file, patch, 0, false, mode)).toBe(0);
  });
  it('eof miss falls back to search from start', () => {
    const file = v(['a', 'END', 'b']);
    expect(seekSequence(file, v(['END']), 0, true, mode)).toBe(1);
  });
  it('eof anchoring matches at end when pattern sits there', () => {
    const file = v(['x', 'y', 'END']);
    expect(seekSequence(file, v(['END']), 0, true, mode)).toBe(2);
  });
});
