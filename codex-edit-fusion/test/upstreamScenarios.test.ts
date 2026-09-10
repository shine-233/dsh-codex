import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePatch, applyPatch, seekSequence } from '../src/index';

// Upstream openai/codex apply-patch scenario fixtures (Apache-2.0), taken from
// codex-rs/apply-patch/tests/fixtures/scenarios. Each scenario is input/ +
// patch.txt + expected/, so this is an end-to-end equivalence check against
// upstream rather than a check that our own implementation matches itself.
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'fixtures', 'upstream-scenarios');

// Deliberate divergences from upstream. These are pinned so a future change
// that accidentally aligns or further diverges them shows up here.
const INTENTIONAL = new Map<string, string>([
  ['010_move_overwrites_existing_destination', 'upstream overwrites the destination; we refuse to clobber'],
  ['011_add_overwrites_existing_file', 'upstream overwrites an existing file; we refuse to clobber'],
  ['015_failure_after_partial_success_leaves_changes', 'upstream keeps partial changes; we roll the whole patch back'],
]);

function readTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const walk = (d: string, prefix: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, rel);
      else out.set(rel, readFileSync(p, 'utf8'));
    }
  };
  walk(dir, '');
  return out;
}

const norm = (s: string) => s.replace(/\r\n/g, '\n');

const scenarios = readdirSync(DIR)
  .filter((n) => statSync(join(DIR, n)).isDirectory())
  .sort();

describe('upstream apply-patch scenarios', () => {
  it('has fixtures to run', () => {
    expect(scenarios.length).toBeGreaterThan(20);
  });

  for (const name of scenarios) {
    it(`${name}`, () => {
      const sdir = join(DIR, name);
      const patchPath = join(sdir, 'patch.txt');
      const input = readTree(join(sdir, 'input'));
      const expected = readTree(join(sdir, 'expected'));
      const rejects = /rejects|fails|requires_existing|invalid/i.test(name);

      let patch;
      try {
        patch = parsePatch(readFileSync(patchPath, 'utf8'));
      } catch (err) {
        // A rejection scenario may fail at parse time; that is the expected
        // outcome. Anything else must parse.
        expect(rejects, `parse threw: ${(err as Error).message}`).toBe(true);
        return;
      }

      const locate = (lines: string[], pattern: string[], start: number, eof: boolean) =>
        seekSequence(lines, pattern, start, eof, 'NormalizeToLf');
      const res = applyPatch(patch, new Map(input), locate);

      if (rejects) {
        expect(res.errors.length).toBeGreaterThan(0);
        return;
      }

      const diffs: string[] = [];
      for (const [p, want] of expected) {
        const have = res.files.get(p);
        if (have === undefined) diffs.push(`missing ${p}`);
        else if (norm(have) !== norm(want)) diffs.push(`content differs: ${p}`);
      }
      for (const [p] of res.files) if (!expected.has(p)) diffs.push(`unexpected file: ${p}`);
      if (res.errors.length) diffs.push(`errors: ${res.errors.join('; ')}`);

      const intentional = INTENTIONAL.get(name);
      if (intentional) {
        // Pinned: still diverging from upstream, for the documented reason.
        expect(diffs.length, `expected to still diverge (${intentional})`).toBeGreaterThan(0);
        return;
      }
      expect(diffs).toEqual([]);
    });
  }
});
