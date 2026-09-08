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
  it('preflight validates the local pack layout', () => {
    const result = validatePackLayout(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.modules.length).toBe(7);
  });
  it('builds a side-effect-free installation plan', () => {
    const plan = buildInstallPlan(process.cwd());
    expect(Object.keys(plan.dependencies)).toHaveLength(7);
    expect(plan.bundles).toContain('@shine233/codex-policy-engine');
    expect(plan.patchPath).toMatch(/cordis\.patch\.yml$/);
  });
  it('previews and applies profile installation with a backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-profile-'));
    const profile = join(dir, 'profile');
    const pkg = join(profile, 'package.json');
    mkdirSync(profile, { recursive: true });
    writeFileSync(pkg, JSON.stringify({ name: 'fixture-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }));
    const plan = buildInstallPlan(process.cwd());
    const beforePreview = readFileSync(pkg, 'utf8');
    const preview = writeProfile(plan, profile);
    expect(preview.mode).toBe('dry-run');
    expect(readFileSync(pkg, 'utf8')).toBe(beforePreview);
    expect(existsSync(join(profile, 'cordis.patch.yml'))).toBe(false);
    const applied = writeProfile(plan, profile, 'apply');
    expect(applied.changed).toBe(true);
    expect(existsSync(`${pkg}.bak`)).toBe(true);
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toContain('dsh-codex-pack');
    const packageBackup = readFileSync(`${pkg}.bak`, 'utf8');
    expect(JSON.parse(packageBackup).name).toBe('fixture-profile');
    expect(existsSync(join(profile, 'cordis.patch.yml.bak'))).toBe(false);
    const second = writeProfile(plan, profile, 'apply');
    expect(second.changed).toBe(false);
    expect(readFileSync(`${pkg}.bak`, 'utf8')).toBe(packageBackup);
  });

  it('refuses to overwrite an existing non-empty patch unless explicitly opted in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-profile-conflict-'));
    const profile = join(dir, 'profile');
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'fixture-profile' }));
    writeFileSync(join(profile, 'cordis.patch.yml'), '# user-owned patch\n- insert: {}\n');
    const plan = buildInstallPlan(process.cwd());
    expect(() => writeProfile(plan, profile, 'apply')).toThrow(/overwritePatch/);
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toContain('user-owned');
    const applied = writeProfile(plan, profile, 'apply', { overwritePatch: true });
    expect(applied.changed).toBe(true);
    expect(existsSync(join(profile, 'cordis.patch.yml.bak'))).toBe(true);
    expect(readFileSync(join(profile, 'cordis.patch.yml.bak'), 'utf8')).toContain('user-owned');
  });

  it('rolls back package.json when patch replacement fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-profile-rollback-'));
    const profile = join(dir, 'profile');
    const pkg = join(profile, 'package.json');
    mkdirSync(profile, { recursive: true });
    const originalPackage = JSON.stringify({ name: 'fixture-profile', dependencies: {} });
    writeFileSync(pkg, originalPackage);
    const originalPatch = '# old patch\n';
    writeFileSync(join(profile, 'cordis.patch.yml'), originalPatch);
    const plan = buildInstallPlan(process.cwd());
    let renames = 0;
    const failingOps = {
      rename(source: string, destination: string) {
        renames += 1;
        if (renames === 2) throw new Error('simulated patch replacement failure');
        return renameSync(source, destination);
      },
    };
    expect(() => writeProfile(plan, profile, 'apply', { overwritePatch: true, fileOps: failingOps })).toThrow(/simulated patch replacement failure/);
    expect(readFileSync(pkg, 'utf8')).toBe(originalPackage);
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(originalPatch);
  });
});
