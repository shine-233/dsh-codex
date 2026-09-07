import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compressColdSessions } from '../src/sessionCompression';
import { rolloutPersistenceMetrics } from '../src/rolloutMetrics';

describe('rolloutPersistenceMetrics (P1-3)', () => {
  it('reports zeroed metrics for an empty or missing dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rm-'));
    expect(rolloutPersistenceMetrics(dir)).toEqual({
      total: 0, uncompressed: 0, compressed: 0,
      totalBytes: 0, uncompressedBytes: 0, compressedBytes: 0,
      savedBytes: 0, savedPct: 0, ordinal: 0, persisted: false,
    });
    expect(rolloutPersistenceMetrics(join(dir, 'nope')).persisted).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts uncompressed + compressed files and measures real savings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rm2-'));
    writeFileSync(join(dir, 'a.jsonl'), 'x'.repeat(100));
    // olderThanMs: -1 -> everything counts as cold; compresses a.jsonl -> a.jsonl.gz
    const r = compressColdSessions(dir, { olderThanMs: -1, minRunIntervalMs: 0, deleteOriginal: true });
    expect(r.compressed).toEqual(['a.jsonl.gz']);

    const m = rolloutPersistenceMetrics(dir);
    expect(m.total).toBe(1);
    expect(m.uncompressed).toBe(0);
    expect(m.compressed).toBe(1);
    expect(m.ordinal).toBe(1);
    expect(m.persisted).toBe(true);
    expect(m.uncompressedBytes).toBe(100);
    expect(m.compressedBytes).toBeLessThan(100);
    expect(m.savedBytes).toBeGreaterThan(0);
    expect(m.savedPct).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('mixed dir: counts both kinds, ignores non-rollout files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rm3-'));
    writeFileSync(join(dir, 'a.jsonl'), 'line1\nline2\n');
    writeFileSync(join(dir, 'b.jsonl.gz'), gzipSync(Buffer.from('compressed body')));
    writeFileSync(join(dir, 'notes.txt'), 'not a rollout');
    const m = rolloutPersistenceMetrics(dir);
    expect(m.total).toBe(2);
    expect(m.uncompressed).toBe(1);
    expect(m.compressed).toBe(1);
    expect(m.ordinal).toBe(2);
    expect(m.persisted).toBe(true);
    expect(m.totalBytes).toBeGreaterThan(0);
    expect(m.savedBytes).toBe(0); // nothing was compressed in place here
    rmSync(dir, { recursive: true, force: true });
  });
});
