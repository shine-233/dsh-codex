import { describe, it, expect } from 'vitest';
import { formatElapsedMillis } from '../src/utils/elapsed';
import { RedactedString } from '../src/utils/redactedString';
import { findCodexHome } from '../src/utils/homeDir';
import { BlockingLruCache } from '../src/utils/cache';
import { fuzzyMatch } from '../src/utils/fuzzyMatch';
import { takeBytesAtCharBoundary, sanitizeMetricTagValue, findUuids, normalizeMarkdownHashLocationSuffix } from '../src/utils/string';
import { parse as parseTemplate, renderTemplate } from '../src/utils/template';
import { AbsolutePathBuf } from '../src/utils/absolutePath';
import { normalizeForPathComparison, pathsMatchAfterNormalization } from '../src/utils/pathUtils';
import { jsonToToml, toTomlString } from '../src/utils/jsonToToml';
import { StreamParser } from '../src/utils/streamParser';
import { detectTerminalName, detectMultiplexer, userAgent } from '../src/utils/terminalDetection';
import { parseFeatures, isFeatureEnabled } from '../src/utils/features';
import { Readiness } from '../src/utils/readiness';

describe('config-importer utils (distilled from upstream utils/* crates)', () => {
  it('elapsed: ms / s / m formats', () => {
    expect(formatElapsedMillis(250)).toBe('250ms');
    expect(formatElapsedMillis(0)).toBe('0ms');
    expect(formatElapsedMillis(2500)).toBe('2.50s');
    expect(formatElapsedMillis(65_000)).toBe('1m 05s');
  });
  it('redacted string never leaks via toString/JSON', () => {
    const secret = new RedactedString('hunter2');
    expect(String(secret)).toBe('REDACTED');
    expect(JSON.stringify({ a: secret })).toBe('{"a":"REDACTED"}');
    expect(secret.intoInner()).toBe('hunter2');
  });
  it('codex home: env override validated, fallback to ~/.codex', () => {
    expect(() => findCodexHome({ CODEX_HOME: 'Z:/no/such' })).toThrow(/does not exist/);
    expect(findCodexHome({})).toMatch(/[.]codex$/);
  });
  it('LRU cache: capacity eviction + get_or_insert_with', () => {
    const c = new BlockingLruCache<string, number>(2);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBeUndefined(); // evicted
    expect(c.getOrInsertWith('b', () => 99)).toBe(2);
  });
  it('fuzzy match: subsequence with indices, rejects impossible', () => {
    expect(fuzzyMatch('hello world', 'hlo')!.indices.length).toBe(3);
    expect(fuzzyMatch('abc', 'zz')).toBeNull();
    expect(fuzzyMatch('abc', '')!.score).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('string utils', () => {
    expect(takeBytesAtCharBoundary('😀😀', 5)).not.toBe('😀😀');
    expect(sanitizeMetricTagValue('a b/c')).toBe('a_b_c');
    expect(findUuids('id 6FA16C2E-9A5F-4B9A-8E29-8B3F4D2C1D10 end')).toHaveLength(1);
    expect(normalizeMarkdownHashLocationSuffix('# My Section')).toBe('my-section');
  });
  it('template: placeholders + render + missing variable error', () => {
    const tpl = parseTemplate('Hello {{ name }}, {{ lang }}!');
    expect(tpl.placeholders).toEqual(['name', 'lang']);
    expect(renderTemplate('Hello {{ name }}!', { name: 'dsh' })).toBe('Hello dsh!');
    expect(() => renderTemplate('{{ missing }}', {})).toThrow(/missing variable/);
  });
  it('absolute path: resolves relative against base', () => {
    expect(AbsolutePathBuf.resolvePathAgainstBase('x.txt', 'C:/tmp').toString()).toMatch(/C:.tmp.x.txt/);
  });
  it('path utils: case/separator-insensitive comparison on win32', () => {
    expect(pathsMatchAfterNormalization('C:\\A\\B', 'c:/a/b')).toBe(true);
    expect(pathsMatchAfterNormalization('C:\\A\\B', 'C:\\A\\C')).toBe(false);
  });
  it('json→toml: null becomes empty string', () => {
    expect(jsonToToml(null)).toBe('');
    expect(jsonToToml({ a: true, b: [1, 2] })).toEqual({ a: true, b: [1, 2] });
  });
  it('stream parser: tolerates split chunks and bad lines', () => {
    const p = new StreamParser<any>();
    const a = p.push('{"a":1}\n{"a":');
    const b = p.push('2}\nbad\n');
    expect(a).toEqual([{ a: 1 }]);
    expect(b).toEqual([{ a: 2 }]);
    expect(p.badLines).toEqual(['bad']);
  });
  it('terminal detection + features', () => {
    expect(detectTerminalName({ TERM_PROGRAM: 'iTerm.app' })).toBe('Iterm2');
    expect(detectMultiplexer({ TMUX: '/tmp/tmux' })?.kind).toBe('Tmux');
    expect(userAgent({})).toContain('codex-config-importer');
    const f = parseFeatures({ web_search: true, guardian_v2: { enabled: true, model: 'g' } });
    expect(isFeatureEnabled(f, 'web_search')).toBe(true);
    expect(f.configured['guardian_v2']).toEqual({ model: 'g' });
    expect(isFeatureEnabled(f, 'unknown_feature')).toBe(false);
  });
  it('readiness: wait resolves after all tokens marked', async () => {
    const r = new Readiness();
    const t1 = r.acquireToken();
    r.acquireToken();
    let done = false;
    const wait = r.waitReady().then(() => { done = true });
    r.markReady(t1);
    expect(done).toBe(false);
    r.markReady(2);
    await wait;
    expect(done).toBe(true);
  });
});

import { findGitRoot } from '../src/utils/gitDiscovery';
describe('gitDiscovery (distilled from utils/git-discovery)', () => {
  it('finds the nearest git root walking up, shares probe cache', () => {
    const root = findGitRoot(import.meta.dirname!);
    expect(root!.endsWith('dsh-codex-monorepo')).toBe(true);
    expect(findGitRoot(import.meta.dirname!)).toBe(root);
  });
  it('returns null outside a repo', () => {
    expect(findGitRoot('Z:/no/repo/here')).toBeNull();
  });
});

import { pathToUri, uriToPath } from '../src/utils/pathUri';
describe('pathUri (distilled from utils/path-uri)', () => {
  it('round-trips windows and posix paths through file:// URIs', () => {
    const winPath = ['C:', 'work', 'a b.txt'].join(String.fromCharCode(92));
    expect(pathToUri(winPath)).toBe('file:///C:/work/a%20b.txt');
    expect(uriToPath('file:///C:/work/a%20b.txt').toLowerCase()).toBe(winPath.toLowerCase());
    expect(uriToPath(pathToUri('/home/u/x.txt'))).toBe('/home/u/x.txt');
    expect(() => uriToPath('http://not-a-file')).toThrow(/not a file URI/);
  });
});
