import { describe, it, expect } from 'vitest';
import { buildInstallPlan, loadLedger, summarizeByModule, statusReport, pendingAdmissions, validatePackLayout, writeProfile } from '../src/index';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = {
  meta: { anchor_commit: '970b7f2ff4f6', upstream: 'openai/codex' },
  entries: [
    { path: 'a', lines: 100, dest: 'mod-x', status: 'implemented' },
    { path: 'b', lines: 200, dest: 'mod-x', status: 'distilled' },
    { path: 'c', lines: 300, dest: 'mod-y', status: 'design-only' },
    { path: 'new-thing', lines: 50, dest: 'EXCLUDED', code: 'E0-pending-admission' },
  ],
};

const aggregatePackage = 'dsh-codex-pack';

describe('dsh-codex-pack ledger health tool', () => {
  it('rolls up status per dest module', () => {
    const s = summarizeByModule(fixture as any);
    const x = s.find((m) => m.dest === 'mod-x')!;
    expect(x.implemented).toBe(1);
    expect(x.distilled).toBe(1);
    expect(x.upstreamLines).toBe(300);
  });
  it('lists pending admissions', () => {
    expect(pendingAdmissions(fixture as any).map((e) => e.path)).toEqual(['new-thing']);
  });
  it('renders a human-readable report', () => {
    const report = statusReport(fixture as any);
    expect(report).toContain('anchor: 970b7f2ff4f6');
    expect(report).toContain('mod-x: 已实现 1 · 蒸馏 1 · 仅设计 0 (上游 300 行)');
    expect(report).toContain('待准入 (E0): new-thing');
  });
  it('loadLedger rejects missing files', () => {
    expect(() => loadLedger('Z:/definitely/not/here.json')).toThrow(/ledger not found/);
  });
  it('preflight validates the local aggregate layout', () => {
    const result = validatePackLayout(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.modules.length).toBe(8);
  });
  it('builds a side-effect-free aggregate installation plan', () => {
    const plan = buildInstallPlan(process.cwd());
    expect(Object.keys(plan.dependencies)).toHaveLength(9);
    expect(plan.dependencies).toHaveProperty(aggregatePackage, process.cwd());
    expect(plan.dependencies).toHaveProperty('codex-policy-engine');
    expect(plan.bundles).toEqual([aggregatePackage]);
    expect(plan.patchPath).toMatch(/cordis\.patch\.yml$/);
  });
  it('updates only package.json and preserves the user patch byte-for-byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-profile-'));
    const profile = join(dir, 'profile');
    const pkg = join(profile, 'package.json');
    const patch = join(profile, 'cordis.patch.yml');
    mkdirSync(profile, { recursive: true });
    writeFileSync(pkg, JSON.stringify({
      name: 'fixture-profile',
      dependencies: { existing: '1.0.0' },
      dsh: { profile: { bundles: ['existing-bundle'] } },
    }));
    const userPatch = '# user-owned patch\n- insert: []\n';
    writeFileSync(patch, userPatch);
    const plan = buildInstallPlan(process.cwd());
    const beforePreview = readFileSync(pkg, 'utf8');
    const preview = writeProfile(plan, profile);
    expect(preview.mode).toBe('dry-run');
    expect(readFileSync(pkg, 'utf8')).toBe(beforePreview);
    expect(readFileSync(patch, 'utf8')).toBe(userPatch);

    const applied = writeProfile(plan, profile, 'apply');
    expect(applied.changed).toBe(true);
    expect(existsSync(`${pkg}.bak`)).toBe(true);
    const installed = JSON.parse(readFileSync(pkg, 'utf8'));
    expect(installed.dependencies.existing).toBe('1.0.0');
    expect(installed.dependencies).toHaveProperty(aggregatePackage);
    expect(installed.dependencies).toHaveProperty('codex-skills-kit');
    expect(installed.dsh.profile.bundles).toEqual(['existing-bundle', aggregatePackage]);
    expect(readFileSync(patch, 'utf8')).toBe(userPatch);
    expect(existsSync(`${patch}.bak`)).toBe(false);

    const packageBackup = readFileSync(`${pkg}.bak`, 'utf8');
    const second = writeProfile(plan, profile, 'apply');
    expect(second.changed).toBe(false);
    expect(readFileSync(`${pkg}.bak`, 'utf8')).toBe(packageBackup);
  });
  it('leaves package.json and the user patch unchanged when replacement fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-profile-rollback-'));
    const profile = join(dir, 'profile');
    const pkg = join(profile, 'package.json');
    const patch = join(profile, 'cordis.patch.yml');
    mkdirSync(profile, { recursive: true });
    const originalPackage = JSON.stringify({ name: 'fixture-profile', dependencies: {} });
    const originalPatch = '# user-owned patch\n';
    writeFileSync(pkg, originalPackage);
    writeFileSync(patch, originalPatch);
    const plan = buildInstallPlan(process.cwd());
    const failingOps = {
      rename(_source: string, _destination: string) {
        throw new Error('simulated package replacement failure');
      },
    };
    expect(() => writeProfile(plan, profile, 'apply', { fileOps: failingOps })).toThrow(/simulated package replacement failure/);
    expect(readFileSync(pkg, 'utf8')).toBe(originalPackage);
    expect(readFileSync(patch, 'utf8')).toBe(originalPatch);
  });
});
