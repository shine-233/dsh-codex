#!/usr/bin/env node
// Rebuild (or verify) the committed esbuild bundles in <package>/lib/index.js.
//
// Each codex-* package ships a single-file esbuild bundle as its package main.
// The bundle entry is not uniform across packages: most bundle src/dsh-plugin.ts
// (every dsh-plugin re-exports its own index surface), but some bundle
// src/index.ts to expose the whole library surface. Rather than guess, the
// script builds both candidates and keeps the one whose export surface covers
// the committed bundle.
//
// Usage:
//   node scripts/rebuild-bundles.mjs                 write bundles to lib/index.js
//   node scripts/rebuild-bundles.mjs --check         fail if any lib is stale
//   node scripts/rebuild-bundles.mjs --pkg codex-prompts
//   node scripts/rebuild-bundles.mjs --esbuild /abs/path/to/esbuild
//
// --check is meant for CI: with --frozen-lockfile installs, esbuild is present
// as a transitive dependency of vite, so a plain install is enough.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { windowsCmdInvocation } from './windows-cmd-invocation.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

function parseArgs(argv) {
  const args = { check: false, pkg: null, esbuild: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--pkg') args.pkg = argv[++i];
    else if (argv[i] === '--esbuild') args.esbuild = argv[++i];
  }
  return args;
}

// Cover every package that ships a generated bundle, not just the ones with a
// dsh-plugin entry: dsh-codex-pack bundles src/index.ts and its package main
// went unverified until a real drift slipped through a rebuild commit.
// dsh-codex-ledger / dsh-codex-ui are excluded on purpose — they have no src/
// and their lib/index.js is hand-written JS, not an esbuild artifact.
function packages() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(ROOT, name, 'src')) && existsSync(join(ROOT, name, 'lib', 'index.js')))
    .sort();
}

function resolveEsbuild(pkgDir, explicit) {
  if (explicit) return { executable: explicit, prefix: [] };
  const bin = join(pkgDir, 'node_modules', '.bin');
  const local = join(bin, process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  if (existsSync(local)) return { executable: local, prefix: [] };

  const esbuildRoot = join(pkgDir, 'node_modules', '.pnpm');
  if (existsSync(esbuildRoot)) {
    const packageDirs = readdirSync(esbuildRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^esbuild@/u.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const packageDir of packageDirs) {
      const launcher = join(esbuildRoot, packageDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
      if (!existsSync(launcher)) continue;
      return process.platform === 'win32'
        ? { executable: process.execPath, prefix: [launcher] }
        : { executable: launcher, prefix: [] };
    }
  }

  return { executable: process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild', prefix: [] };
}

function exportsOf(js) {
  const m = js.match(/export\s*\{([\s\S]*?)\}/g) || [];
  const names = new Set();
  for (const block of m) {
    for (const part of block.replace(/export\s*\{|\}/g, '').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

const args = parseArgs(process.argv.slice(2));
const pkgs = args.pkg ? [args.pkg] : packages();
const tmp = mkdtempSync(join(tmpdir(), 'dsh-bundles-'));
let drift = 0;
const failures = [];

// Run esbuild from inside the package with relative paths: it stamps source
// comments relative to the cwd, so building from the repo root would prefix
// every comment with the package name and report a false drift.
function build(esbuild, pkgDir, entry, out) {
  const args = [...esbuild.prefix, entry, '--bundle', '--format=esm', '--platform=node', '--packages=external', `--outfile=${out}`];
  // Windows package shims are .cmd files and cannot be launched directly by
  // execFileSync without a shell. Keep the normal direct path for real
  // binaries, including Linux CI, while making local Windows checks work.
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(esbuild.executable)) {
    const invocation = windowsCmdInvocation(esbuild.executable, args);
    execFileSync(invocation.executable, invocation.args, {
      cwd: pkgDir,
      stdio: 'pipe',
      windowsVerbatimArguments: true,
    });
  } else if (process.platform === 'win32' && /\.ps1$/i.test(esbuild.executable)) {
    throw new Error('PowerShell command shims are not supported; use a .cmd shim or executable');
  } else {
    execFileSync(esbuild.executable, args, { cwd: pkgDir, stdio: 'pipe' });
  }
  return readFileSync(join(pkgDir, out), 'utf8');
}

try {
  for (const pkg of pkgs) {
    const pkgDir = join(ROOT, pkg);
    const pluginRel = join('src', 'dsh-plugin.ts');
    const indexRel = join('src', 'index.ts');
    const rels = [pluginRel, indexRel].filter((rel) => existsSync(join(pkgDir, rel)));
    if (!rels.length) {
      failures.push(`${pkg}: no src/dsh-plugin.ts or src/index.ts`);
      continue;
    }
    const target = join(pkgDir, 'lib', 'index.js');
    const esbuild = resolveEsbuild(pkgDir, args.esbuild);
    // Build next to the committed bundle: esbuild writes source-path comments
    // relative to the outfile, so a temp dir elsewhere would produce noise.
    const scratchRel = join('lib', '__bundle-check.js');
    const scratch = join(pkgDir, scratchRel);
    const committedText = existsSync(target) ? readFileSync(target, 'utf8') : null;
    const committedExports = committedText ? exportsOf(committedText) : [];

    let chosen;
    try {
      const candidates = rels.map((rel) => ({ rel, js: build(esbuild, pkgDir, rel, scratchRel) }));
      // Prefer dsh-plugin.ts; only switch when index.ts strictly covers more of
      // the committed export surface.
      const coverage = (js) => committedExports.filter((n) => exportsOf(js).includes(n)).length;
      chosen = candidates[0];
      for (const c of candidates.slice(1)) {
        if (coverage(c.js) > coverage(chosen.js)) chosen = c;
      }
    } catch (err) {
      failures.push(`${pkg}: esbuild failed (${(err.stderr || err.message).toString().trim().split('\n')[0]})`);
      continue;
    } finally {
      if (existsSync(scratch)) rmSync(scratch, { force: true });
    }

    if (!args.check) {
      build(esbuild, pkgDir, chosen.rel, join('lib', 'index.js'));
      console.log(`  wrote  ${pkg}/lib/index.js (from ${chosen.rel})`);
      continue;
    }

    const fresh = build(esbuild, pkgDir, chosen.rel, scratchRel);
    if (existsSync(scratch)) rmSync(scratch, { force: true });

    if (committedText !== null && fresh.trim() !== committedText.trim()) {
      drift++;
      const a = committedText.split('\n');
      const b = fresh.split('\n');
      const at = a.findIndex((line, i) => line !== b[i]);
      const detail = at < 0 ? 'trailing whitespace/newline only' : `line ${at + 1}: committed=${JSON.stringify((a[at] || '').slice(0, 80))} fresh=${JSON.stringify((b[at] || '').slice(0, 80))}`;
      failures.push(`${pkg}: lib/index.js is stale — ${detail}`);
    }
    const missing = committedExports.filter((n) => !exportsOf(fresh).includes(n));
    if (missing.length) {
      drift++;
      failures.push(`${pkg}: rebuild would drop exports: ${missing.join(', ')}`);
    }
    console.log(`  ok     ${pkg}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n${pkgs.length} package(s) checked, ${drift} drift.`);
