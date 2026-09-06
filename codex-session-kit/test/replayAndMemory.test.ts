import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replayRollout, replayRolloutText, forkPrefix } from '../src/replay';
import { StructuredMemoryStore, rolloutSummaryFileStem } from '../src/structuredMemory';

const items = [
  { type: 'session_meta', payload: { id: 's1', cwd: 'C:/w' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
  { type: 'token_usage_record', payload: { thread_id: 't', usage: {} } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] } },
];

describe('replayRollout (distilled from rollout crate)', () => {
  it('assigns sequence numbers and extracts ordered messages', () => {
    const r = replayRollout(items);
    expect(r.lastSeq).toBe(4);
    expect(r.messages).toEqual([
      { role: 'user', text: 'hi', seq: 2 },
      { role: 'assistant', text: 'answer', seq: 4 },
    ]);
  });
  it('atSeq replays a prefix (fork/resume semantics)', () => {
    const r = replayRollout(items, { atSeq: 2 });
    expect(r.lastSeq).toBe(2);
    expect(r.events).toHaveLength(2);
  });
  it('forkPrefix slices verbatim', () => {
    expect(forkPrefix(items, 2)).toHaveLength(2);
    expect(forkPrefix(items, 99)).toHaveLength(4);
  });
  it('replayRolloutText surfaces bad lines alongside the replay', () => {
    // header-only file + garbage: header is not an item, so lastSeq stays 0.
    const r = replayRolloutText(JSON.stringify(items[0]) + '\ngarbage\n');
    expect(r.badLines).toBe(1);
    expect(r.lastSeq).toBe(0);
  });
});

describe('StructuredMemoryStore (distilled from memories/write+read)', () => {
  const dir = join(tmpdir(), `sm-test-${Date.now()}`);
  beforeAll(() => { rmSync(dir, { recursive: true, force: true }) });

  it('writes and reads per-origin sections', () => {
    const s = new StructuredMemoryStore(dir);
    s.writeMemory('session-abc', 'user prefers concise answers');
    s.writeMemory('session-def', 'project uses pnpm');
    expect(s.readMemory('session-abc')).toContain('concise');
    expect(s.listOrigins()).toEqual(['session-abc', 'session-def']);
  });
  it('rewrites a section idempotently', () => {
    const s = new StructuredMemoryStore(dir);
    s.writeMemory('session-abc', 'updated');
    expect(s.readMemory('session-abc')).toBe('updated');
    expect(s.listOrigins()).toEqual(['session-abc', 'session-def']);
  });
  it('bounds section size', () => {
    const s = new StructuredMemoryStore(dir);
    s.writeMemory('big', 'z'.repeat(99999), { maxChars: 100 });
    expect(s.readMemory('big')!.length).toBe(100);
  });
  it('rebuild drops origins whose summaries vanished (growth guard)', () => {
    const s = new StructuredMemoryStore(dir);
    s.writeMemory('gone-origin', 'lost');
    rmSync(join(dir, 'rollout_summaries', `${rolloutSummaryFileStem('gone-origin')}.md`), { force: true });
    const dropped = s.rebuildFromSummaries();
    expect(dropped).toBe(1);
    expect(s.listOrigins()).not.toContain('gone-origin');
  });
  it('forget removes both section and summary artifact', () => {
    const s = new StructuredMemoryStore(dir);
    s.writeMemory('temp', 'x');
    s.forget('temp');
    expect(s.readMemory('temp')).toBeNull();
  });
});
