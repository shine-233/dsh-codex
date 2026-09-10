import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { windowsCmdInvocation } from './windows-cmd-invocation.mjs';

test('builds cmd.exe invocation with the required outer quotes', () => {
  const invocation = windowsCmdInvocation(
    'C:\\space dir\\esbuild.cmd',
    ['src\\entry file.ts', '--outfile=lib\\output file.js'],
    'C:\\Windows\\System32\\cmd.exe',
  );
  assert.deepEqual(invocation, {
    executable: 'C:\\Windows\\System32\\cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      '""C:\\space dir\\esbuild.cmd" "src\\entry file.ts" "--outfile=lib\\output file.js""',
    ],
  });
});

test('rejects PowerShell shims rather than routing them through cmd.exe', () => {
  assert.throws(
    () => windowsCmdInvocation('C:\\tools\\esbuild.ps1', []),
    /unsupported Windows command shim: \.ps1/,
  );
});

test('rejects argument characters that cmd.exe would expand or misparse', () => {
  for (const value of ['bad"arg', 'percent%value', 'delayed!value', 'line\nbreak']) {
    assert.throws(
      () => windowsCmdInvocation('C:\\tools\\esbuild.cmd', [value]),
      /unsupported character in Windows command argument/,
    );
  }
});

test('rejects shim paths that cmd.exe would expand or misparse', () => {
  for (const value of ['C:\\bad%path\\esbuild.cmd', 'C:\\bad&path\\esbuild.cmd']) {
    assert.throws(
      () => windowsCmdInvocation(value, []),
      /unsupported character in Windows command shim path/,
    );
  }
});

test('launches a cmd shim from a path containing spaces without changing argv', {
  skip: process.platform !== 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh cmd shim '));
  try {
    const shimDir = join(root, 'shim path');
    mkdirSync(shimDir);
    const shim = join(shimDir, 'capture args.cmd');
    const output = join(root, 'captured args.txt');
    const capture = join(shimDir, 'capture.mjs');
    writeFileSync(capture, [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(process.env.DSH_CAPTURE_FILE, JSON.stringify(process.argv.slice(2)));",
    ].join('\n'));
    writeFileSync(shim, [
      '@echo off',
      'node "%~dp0capture.mjs" %*',
    ].join('\r\n'));
    const expected = [
      'src\\entry file.ts',
      '--bundle',
      '--outfile=lib\\output file.js',
      'caret^value',
      'amp&value',
      'pipe|value',
      'less<value',
      'greater>value',
    ];
    const invocation = windowsCmdInvocation(shim, expected);
    execFileSync(invocation.executable, invocation.args, {
      env: { ...process.env, DSH_CAPTURE_FILE: output },
      stdio: 'pipe',
      windowsVerbatimArguments: true,
    });
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
