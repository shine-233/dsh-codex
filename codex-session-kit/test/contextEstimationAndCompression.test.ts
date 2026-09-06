import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, utimesSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  estimateImageBytes, estimateItemTokenCount, isUserTurnBoundary, RESIZED_IMAGE_BYTES_ESTIMATE,
} from '../src/contextEstimation';
import { compressColdSessions, readSessionFile } from '../src/sessionCompression';

describe('contextEstimation (distilled from core context_manager/history.rs)', () => {
  it('resized image estimate is 7373 bytes ≈ 1844 tokens', () => {
    expect(RESIZED_IMAGE_BYTES_ESTIMATE).toBe(7373);
    expect(estimateImageBytes('data:image/png;base64,AAAA')).toBe(7373);
  });
  it('inline base64 payloads are replaced by the resized estimate', () => {
    const big = 'A'.repeat(100000);
    const payload = { content: [{ type: 'input_image', image_url: `data:image/png;base64,${big}` }] };
    const tokens = estimateItemTokenCount(payload);
    expect(tokens).toBeLessThan(100000 / 4); // raw base64 discounted
    expect(tokens).toBeGreaterThanOrEqual(7373 / 4); // resized estimate floor
  });
  it('user messages are turn boundaries; assistant/tool events are not', () => {
    expect(isUserTurnBoundary({ type: 'user_message', payload: {} })).toBe(true);
    expect(isUserTurnBoundary({ type: 'response_item', payload: { type: 'message', role: 'user' } })).toBe(true);
    expect(isUserTurnBoundary({ type: 'response_item', payload: { type: 'message', role: 'assistant' } })).toBe(false);
    expect(isUserTurnBoundary({ type: 'token_usage_record', payload: {} })).toBe(false);
  });
});

describe('sessionCompression (distilled from rollout compression.rs)', () => {
  const dir = join(tmpdir(), `compress-test-${Date.now()}`);
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old.jsonl'), '{"type":"session_meta"}\n');
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    utimesSync(join(dir, 'old.jsonl'), old, old);
    writeFileSync(join(dir, 'fresh.jsonl'), '{"type":"session_meta"}\n');
  });
  it('compresses cold files, skips fresh ones, and writes a run marker', () => {
    const r = compressColdSessions(dir, { olderThanMs: 7 * 24 * 3600 * 1000 });
    expect(r.compressed).toEqual(['old.jsonl.gz']);
    expect(r.skipped).toEqual(['fresh.jsonl']);
    expect(existsSync(join(dir, 'old.jsonl.gz'))).toBe(true);
    expect(existsSync(join(dir, 'old.jsonl'))).toBe(false);
    expect(existsSync(join(dir, '.compression-run'))).toBe(true);
  });
  it('transparent read restores gz content', () => {
    expect(readSessionFile(join(dir, 'old.jsonl.gz'))).toContain('session_meta');
  });
  it('min run interval prevents overlapping runs', () => {
    writeFileSync(join(dir, 'cold2.jsonl'), 'x');
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    utimesSync(join(dir, 'cold2.jsonl'), old, old);
    const r = compressColdSessions(dir, { olderThanMs: 7 * 24 * 3600 * 1000 });
    expect(r.compressed).toEqual([]); // marker blocks a second run within the interval
    rmSync(dir, { recursive: true, force: true });
  });
});
