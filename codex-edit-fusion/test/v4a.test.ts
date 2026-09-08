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

  it('does not partially commit when a later hunk fails', () => {
    const files = new Map([['src/app.ts', 'one\ntwo\nthree']]);
    const patch = parsePatch([
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-one',
      '+ONE',
      '@@',
      '-missing',
      '+MISSING',
      '*** End Patch',
    ].join('\n'));

    const result = applyPatch(patch, files);

    expect(result.errors).toEqual(['hunk not found in src/app.ts']);
    expect(result.results).toEqual([]);
    expect(result.files).toEqual(files);
    expect(result.files.get('src/app.ts')).toBe('one\ntwo\nthree');
  });

  it('does not partially commit an earlier file when a later file fails', () => {
    const files = new Map([
      ['a.txt', 'old'],
      ['b.txt', 'present'],
    ]);
    const patch = parsePatch([
      '*** Begin Patch',
      '*** Update File: a.txt',
      '@@',
      '-old',
      '+new',
      '*** Update File: missing.txt',
      '@@',
      '-nope',
      '+still missing',
      '*** End Patch',
    ].join('\n'));

    const result = applyPatch(patch, files);

    expect(result.errors).toContain('update target missing: missing.txt');
    expect(result.results).toEqual([]);
    expect(result.files).toEqual(files);
    expect(result.files.get('a.txt')).toBe('old');
  });

  it('rejects a move into an existing file without changing either file', () => {
    const files = new Map([
      ['from.txt', 'source'],
      ['to.txt', 'destination'],
    ]);
    const patch = parsePatch([
      '*** Begin Patch',
      '*** Update File: from.txt',
      '*** Move to: to.txt',
      '*** End Patch',
    ].join('\n'));

    const result = applyPatch(patch, files);

    expect(result.errors).toEqual(['move target already exists: to.txt']);
    expect(result.results).toEqual([]);
    expect(result.files).toEqual(files);
  });

  it('applies multiple hunks against the result of the previous hunk', () => {
    const files = new Map([['src/app.ts', 'one\ntwo\nthree\nfour']]);
    const patch = parsePatch([
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-one',
      '+ONE',
      '@@',
      '-three',
      '+THREE',
      '*** End Patch',
    ].join('\n'));

    const result = applyPatch(patch, files);

    expect(result.errors).toEqual([]);
    expect(result.files.get('src/app.ts')).toBe('ONE\ntwo\nTHREE\nfour');
  });

  it('preserves CRLF line endings when updating a Windows file', () => {
    const files = new Map([['win.txt', 'one\r\ntwo\r\nthree\r\n']]);
    const patch = parsePatch([
      '*** Begin Patch', '*** Update File: win.txt', '@@',
      '-two', '+TWO', '*** End Patch',
    ].join('\n'));
    const result = applyPatch(patch, files);
    expect(result.errors).toEqual([]);
    expect(result.files.get('win.txt')).toBe('one\r\nTWO\r\nthree\r\n');
  });

  it('uses the EOF marker for an append hunk and exposes it to the locator', () => {
    const files = new Map([['tail.txt', 'first\nlast']]);
    const seen: boolean[] = [];
    const patch = parsePatch([
      '*** Begin Patch', '*** Update File: tail.txt', '@@',
      '+appended', '*** End of File', '*** End Patch',
    ].join('\n'));
    const result = applyPatch(patch, files, (_lines, _pattern, _start, eof) => {
      seen.push(eof);
      return null;
    });
    expect(result.errors).toEqual([]);
    expect(seen).toEqual([true]);
    expect(result.files.get('tail.txt')).toBe('first\nlast\nappended');
  });

  it('rejects malformed patches instead of silently ignoring directives', () => {
    expect(() => parsePatch('*** Begin Patch\n*** Bogus: file\n*** End Patch')).toThrow(/unexpected directive/);
    expect(() => parsePatch('*** Begin Patch\n*** Update File: x\n@@\n-old\n+new')).toThrow(/missing \*\*\* End Patch/);
    expect(() => parsePatch('*** Begin Patch\n*** Add File: x\nnot-prefixed\n*** End Patch')).toThrow(/malformed add file body/);
  });

  it('rolls back a multi-file patch when a move boundary fails', () => {
    const files = new Map([['a.txt', 'A'], ['b.txt', 'B']]);
    const patch = parsePatch([
      '*** Begin Patch', '*** Update File: a.txt', '*** Move to: c.txt',
      '*** Update File: b.txt', '*** Move to: c.txt',
      '*** End Patch',
    ].join('\n'));
    const result = applyPatch(patch, files);
    expect(result.errors).toEqual(['move target already exists: c.txt']);
    expect(result.results).toEqual([]);
    expect(result.files).toEqual(files);
  });
});
