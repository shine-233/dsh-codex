import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillList, skillRead, MAX_SKILL_RESOURCE_CONTENT_BYTES } from '../src/executor';

// Fixtures live in a fresh OS-temp dir per run: no repo litter, no hidden
// reset state, and rmSync stays on tmpdir paths (repo-local rmSync is routed
// through the sandbox trash helper, which must not be a test dependency).
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-fixtures-'));
  const pkg = join(root, 'my-skill');
  mkdirSync(join(pkg, 'docs'), { recursive: true });
  writeFileSync(join(pkg, 'SKILL.md'), '# My Skill\nDoes things.');
  writeFileSync(join(pkg, 'docs', 'guide.md'), 'guide body');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('skillRead/skillList (distilled from ext/skills tools/read.rs)', () => {
  it('lists skill packages', () => {
    expect(skillList(root)).toEqual(['my-skill']);
  });
  it('reads SKILL.md by default', () => {
    const r = skillRead(root, { package: 'my-skill' });
    expect(r.resource).toBe('SKILL.md');
    expect(r.contents).toContain('# My Skill');
    expect(r.nextOffset).toBeNull();
  });
  it('rejects path escapes (authority)', () => {
    expect(() => skillRead(root, { package: 'my-skill', resource: '../../escape.md' })).toThrow(/escapes/);
    expect(() => skillRead(root, { package: '../outside' })).toThrow(/not found under/);
  });
  it('rejects missing resources', () => {
    expect(() => skillRead(root, { package: 'my-skill', resource: 'nope.md' })).toThrow(/not found/);
  });
  it('pages large resources via offset cursor', () => {
    const big = join(root, 'my-skill', 'big.md');
    writeFileSync(big, 'x'.repeat(MAX_SKILL_RESOURCE_CONTENT_BYTES + 10));
    const first = skillRead(root, { package: 'my-skill', resource: 'big.md', offset: 0 });
    expect(first.contents.length).toBe(MAX_SKILL_RESOURCE_CONTENT_BYTES);
    expect(first.nextOffset).toBe(MAX_SKILL_RESOURCE_CONTENT_BYTES);
    const second = skillRead(root, { package: 'my-skill', resource: 'big.md', offset: first.nextOffset! });
    expect(second.contents).toBe('x'.repeat(10));
    expect(second.nextOffset).toBeNull();
  });
});
