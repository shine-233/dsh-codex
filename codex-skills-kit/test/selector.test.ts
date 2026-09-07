import { describe, it, expect } from 'vitest';
import {
  normalizeToken,
  buildAliasIndex,
  resolveAlias,
  selectSkills,
  type SkillWithAliases,
} from '../src/selector';

const SKILLS: SkillWithAliases[] = [
  { name: 'git-hub', description: 'manage repositories and pull requests', aliases: ['gh'] },
  { name: 'git-lab', description: 'self-hosted git forge', aliases: ['gl'] },
  { name: 'docker', description: 'build and run containers' },
  { name: 'kubernetes', description: 'orchestrate container deployments' },
  { name: 'pdf-tools', description: 'merge, split and compress pdf documents' },
];

describe('normalizeToken', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(normalizeToken('Git_Hub!! v2')).toBe('git hub v2');
    expect(normalizeToken('  spaced---out ')).toBe('spaced out');
    expect(normalizeToken('')).toBe('');
  });
});

describe('buildAliasIndex / resolveAlias', () => {
  const idx = buildAliasIndex(SKILLS);
  it('maps canonical names and declared aliases', () => {
    expect(resolveAlias('git-hub', idx)).toBe('git-hub');
    expect(resolveAlias('GH', idx)).toBe('git-hub');
    expect(resolveAlias('gl', idx)).toBe('git-lab');
  });
  it('falls back to prefix/contains matching', () => {
    expect(resolveAlias('git', idx)).toBe('git-hub'); // prefix of "git-hub"
    expect(resolveAlias('kube', idx)).toBe('kubernetes');
  });
  it('returns null on no match', () => {
    expect(resolveAlias('zzz', idx)).toBeNull();
    expect(resolveAlias('', idx)).toBeNull();
  });
});

describe('selectSkills (dynamic selector)', () => {
  it('ranks an exact alias reference highest', () => {
    const picked = selectSkills('gh', SKILLS);
    expect(picked[0].name).toBe('git-hub');
  });

  it('matches description tokens and orders by score', () => {
    const picked = selectSkills('pdf compress', SKILLS);
    expect(picked.map((s) => s.name)).toContain('pdf-tools');
    // "pdf" appears in pdf-tools name (+2) and "compress" in its description (+1) = 3
    expect(picked[0].name).toBe('pdf-tools');
  });

  it('respects the limit', () => {
    const picked = selectSkills('git container orchestrate', SKILLS, { limit: 2 });
    expect(picked.length).toBe(2);
  });

  it('drops skills below minScore', () => {
    const picked = selectSkills('docker', SKILLS, { minScore: 3 });
    expect(picked.map((s) => s.name)).toEqual(['docker']);
  });

  it('returns [] for an empty query', () => {
    expect(selectSkills('   ', SKILLS)).toEqual([]);
  });

  it('breaks score ties deterministically by name', () => {
    const tied: SkillWithAliases[] = [
      { name: 'zebra', description: 'foo bar' },
      { name: 'alpha', description: 'foo bar' },
    ];
    const picked = selectSkills('foo', tied);
    expect(picked.map((s) => s.name)).toEqual(['alpha', 'zebra']);
  });

  it('prefers alias/name hits over description-only hits', () => {
    const picked = selectSkills('docker', SKILLS);
    expect(picked[0].name).toBe('docker'); // exact name (+3) beats kubernetes? no docker wins
    // docker exact-name=3; nothing else matches "docker" -> only docker
    expect(picked.length).toBe(1);
  });
});
