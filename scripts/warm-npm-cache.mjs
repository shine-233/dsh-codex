#!/usr/bin/env node
// Warm the npm cache with the runtime dependency closure that
// `dsh-codex-pack/test/offlineClosure.test.ts` needs before it runs
// `npm install --offline`.
//
// Why this exists: the two offline install cases are publication-closure
// proofs, so they run with `--offline` on purpose — no network, no registry
// resolution. That only holds if every non-`file:` dependency in the closure is
// already in the npm cache. CI installs with pnpm, which fills the pnpm store
// and never touches ~/.npm/_cacache, so on a fresh runner both cases die with
// `ENOTCACHED` before they can prove anything:
//
//   npm error request to https://registry.npmjs.org/@standard-schema%2fspec
//   failed: cache mode is 'only-if-cached' but no cached response is available.
//
// So the test job warms the cache first. The dependency set is read from the
// packages' own `dependencies` (runtime only — the offline install runs with
// `--legacy-peer-deps` and no devDependencies) rather than hardcoded, so it
// stays honest when a manifest changes.
//
// Usage:
//   node scripts/warm-npm-cache.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors COMPONENTS + PACK in dsh-codex-pack/test/offlineClosure.test.ts.
// Adding a component there means adding it here too; the existence check below
// fails loudly if this list ever points at a package that no longer exists.
const PACKAGES = [
  'codex-policy-engine',
  'codex-edit-fusion',
  'codex-config-importer',
  'codex-prompts',
  'codex-session-kit',
  'codex-net-guard',
  'codex-schema',
  'codex-skills-kit',
  'dsh-codex-pack',
];

const specs = new Set();
for (const name of PACKAGES) {
  const manifestPath = join(ROOT, name, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`warm-npm-cache: ${name}/package.json is missing — the package list is stale`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
    specs.add(`${dep}@${range}`);
  }
}

if (specs.size === 0) {
  throw new Error('warm-npm-cache: no runtime dependencies found — refusing to warm an empty set');
}

const work = mkdtempSync(join(tmpdir(), 'npm-cache-warm-'));
try {
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'npm-cache-warm', version: '0.0.0', private: true }, null, 2),
  );
  const args = [
    'install',
    '--no-audit',
    '--no-fund',
    // Nothing here is loaded, only cached: native build scripts (fs-ext,
    // koffi) would need a toolchain the runner may not have.
    '--ignore-scripts',
    ...specs,
  ];
  console.log(`warm-npm-cache: npm ${args.join(' ')}`);
  // The spec list is derived from manifests, so it could in principle carry a
  // shell metacharacter. On Windows the .cmd shim needs a shell; on POSIX it
  // does not. Only allow the characters a package spec can legitimately use,
  // which keeps the shell path safe on both.
  const unsafe = args.filter((arg) => !/^[\w@./^~*-]+$/u.test(arg));
  if (unsafe.length > 0) {
    throw new Error(`warm-npm-cache: refusing to pass shell-unsafe arguments: ${unsafe.join(', ')}`);
  }
  if (process.platform === 'win32') {
    // `npm` on Windows is a .cmd shim, so it needs cmd.exe. Invoke it by bare
    // name with `shell: true` (the same way offlineClosure.test.ts does):
    // passing the shim through windowsCmdInvocation makes `%~dp0` resolve to
    // the *current* directory instead of the shim's own, and npm then looks for
    // its CLI in the throwaway directory.
    execFileSync('npm.cmd', args, { cwd: work, stdio: 'inherit', shell: true });
  } else {
    execFileSync('npm', args, { cwd: work, stdio: 'inherit' });
  }
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch (error) {
    // A failed cleanup is not a test failure: the directory lives in tmpdir.
    console.warn(`warm-npm-cache: could not remove ${work}: ${error.message}`);
  }
}

console.log(`warm-npm-cache: cached ${specs.size} runtime dependencies`);
