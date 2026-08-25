import { describe, it, expect } from 'vitest';
import { parsePatch, applyPatch } from '../src/index';

const PATCH = [
'*** Begin Patch',
'*** Add File: docs/new.md',
'+hello world',
'*** Update File: src/app.ts',
'@@ function greet() {',
' const msg = "hi";',
'-return msg;',
'+return msg + "!"',
'*** Delete File: src/old.ts',
'*** End Patch',
].join('\n');

describe('V4A parser + applier', () => {
  it('parses all three operation kinds', () => {
    const p = parsePatch(PATCH);
    expect(p.addFiles[0].path).toBe('docs/new.md');
    expect(p.updateFiles[0].hunks.length).toBe(1);
    expect(p.updateFiles[0].hunks[0].lines.some(l=>l.kind==='remove')).toBe(true);
    expect(p.deleteFiles).toEqual(['src/old.ts']);
  });
  it('applies add/update/delete against file map', () => {
    const files = new Map([
      ['src/app.ts', 'function greet() {\n  const msg = "hi";\n  return msg;\n}'],
      ['src/old.ts', 'legacy'],
    ]);
    const p = parsePatch(PATCH);
    const { files: out, results, errors } = applyPatch(p, files);
    expect(errors).toEqual([]);
    expect(out.get('docs/new.md')).toBe('hello world');
    expect(out.get('src/app.ts')).toContain('return msg + "!"');
    expect(out.has('src/old.ts')).toBe(false);
    expect(results.length).toBe(3);
  });
});
