import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryThreadStore, JsonlFileThreadStore, createThreadStore } from '../src/threadStore';

describe('InMemoryThreadStore', () => {
  it('create/get/listByProject/queue/drain roundtrip', () => {
    const s = new InMemoryThreadStore();
    const t = s.create({ threadId: 't1', project: 'p1', source: 'local', title: 'hello' });
    expect(t.createdAt).toBeGreaterThan(0);
    expect(s.get('t1')?.title).toBe('hello');
    expect(s.get('nope')).toBeNull();
    s.create({ threadId: 't2', project: 'p2', source: 'imported' });
    expect(s.listByProject('p1').map((x) => x.threadId)).toEqual(['t1']);
    s.queueSubmission({ threadId: 't1', text: 'a', queuedAt: 1 });
    s.queueSubmission({ threadId: 't2', text: 'b', queuedAt: 2 });
    expect(s.drainQueue('t1')).toEqual([{ threadId: 't1', text: 'a', queuedAt: 1 }]);
    expect(s.drainQueue('t1')).toEqual([]);
    expect(s.drainQueue('t2')).toEqual([{ threadId: 't2', text: 'b', queuedAt: 2 }]);
  });
});

describe('JsonlFileThreadStore (durable backend, P1-4)', () => {
  it('persists threads and queue across reopen (new process)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-'));
    const file = join(dir, 'threads.jsonl');
    const s1 = new JsonlFileThreadStore(file);
    s1.create({ threadId: 't1', project: 'p1', source: 'local' });
    s1.queueSubmission({ threadId: 't1', text: 'queued msg', queuedAt: 5 });

    const s2 = new JsonlFileThreadStore(file);
    expect(s2.get('t1')?.project).toBe('p1');
    expect(s2.listByProject('p1').map((x) => x.threadId)).toEqual(['t1']);
    expect(s2.drainQueue('t1')).toEqual([{ threadId: 't1', text: 'queued msg', queuedAt: 5 }]);

    // Drain is itself durable: a third instance sees the emptied queue.
    const s3 = new JsonlFileThreadStore(file);
    expect(s3.drainQueue('t1')).toEqual([]);
    expect(s3.get('t1')).not.toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('tolerates bad lines without losing valid state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-bad-'));
    const file = join(dir, 'threads.jsonl');
    const s1 = new JsonlFileThreadStore(file);
    s1.create({ threadId: 'ok', project: 'p', source: 'local' });
    appendFileSync(file, 'NOT JSON {{{\n', 'utf8');
    const s2 = new JsonlFileThreadStore(file);
    expect(s2.get('ok')).not.toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createThreadStore factory', () => {
  it('file path selects the durable backend, default stays in-memory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-fac-'));
    const file = join(dir, 'threads.jsonl');
    createThreadStore({ file }).create({ threadId: 'x', project: 'p', source: 'local' });
    expect(createThreadStore({ file }).get('x')).not.toBeNull();
    createThreadStore().create({ threadId: 'y', project: 'p', source: 'local' });
    expect(createThreadStore().get('y')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
