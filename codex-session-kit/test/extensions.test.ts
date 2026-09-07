import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryThreadStore } from '../src/threadStore';
import { MessageHistory } from '../src/messageHistory';
import { searchFiles } from '../src/fileSearch';
import { AgentGraphStore } from '../src/agentGraph';
import { traceTimeline, turnSummaries } from '../src/rolloutTrace';
import { NotesStore } from '../src/extNotes';

const tmp = mkdtempSync(join(tmpdir(), 'sk-extensions-'));

describe('threadStore (distilled from thread-store crate)', () => {
  it('creates, lists per project, and drains queued submissions', () => {
    const store = new InMemoryThreadStore();
    store.create({ threadId: 't1', project: 'C:/w', source: 'local', title: 'one' });
    store.create({ threadId: 't2', project: 'C:/w', source: 'imported' });
    expect(store.listByProject('C:/w')).toHaveLength(2);
    expect(store.listByProject('C:/other')).toHaveLength(0);
    store.queueSubmission({ threadId: 't2', text: 'later', queuedAt: 1 });
    expect(store.drainQueue('t2')).toHaveLength(1);
    expect(store.drainQueue('t2')).toHaveLength(0);
  });
});

describe('messageHistory (distilled from message-history crate)', () => {
  it('appends, caps, and looks up by log id', () => {
    const dir = join(tmp, 'history');
    const h = new MessageHistory({ codexHome: dir, maxBytes: 400 });
    h.add({ sessionId: 's1', text: 'first message' });
    h.add({ sessionId: 's1', text: 'second message' });
    expect(h.bySession('s1')).toHaveLength(2);
    expect(h.lookup(1)?.text).toContain('first');
    expect(h.lookup(99)).toBeNull();
  });
});

describe('fileSearch (distilled from file-search crate)', () => {
  const dir = join(tmp, 'search');
  beforeAll(() => {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'hello.txt'), '');
    writeFileSync(join(dir, 'sub', 'hello-world.md'), '');
    writeFileSync(join(dir, 'unrelated.bin'), '');
  });
  it('scores basename matches with prefix bonus first', () => {
    const results = searchFiles(dir, 'hello', 5);
    expect(results[0].path).toBe(join('hello.txt'));
    expect(results.length).toBe(2);
    expect(results.every((m) => m.matchType === 'basename')).toBe(true);
  });
});

describe('agentGraph (distilled from agent-graph-store crate)', () => {
  it('records spawn edges and status transitions with JSONL persistence', () => {
    const file = join(tmp, 'graph.jsonl');
    const g = new AgentGraphStore(file);
    g.addAgent('parent', 'root');
    g.addAgent('child', 'sub');
    g.addSpawnEdge('parent', 'child', 'running');
    g.setEdgeStatus('child', 'completed');
    const g2 = new AgentGraphStore(file); // rebuild from log
    expect(g2.nodeCount()).toBe(2);
    expect(g2.childrenOf('parent')[0].status).toBe('completed');
  });
});

describe('rolloutTrace (distilled from rollout-trace crate)', () => {
  it('builds a timeline and per-turn summaries', () => {
    const items = [
      { type: 'session_meta', payload: {} },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'q' }] } },
      { type: 'response_item', payload: { type: 'function_call', name: 'shell' } },
      { type: 'token_usage_record', payload: {} },
    ];
    const trace = traceTimeline(items);
    expect(trace.map((t) => t.kind)).toEqual(['message', 'tool_call', 'usage']);
    const turns = turnSummaries(trace);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ messages: 1, toolCalls: 1, usage: 1 });
  });
});

describe('extNotes (distilled from ext/history-notes + ext/memories)', () => {
  it('add/list/remove notes scoped by thread', () => {
    const s = new NotesStore(join(tmp, 'notes.jsonl'));
    s.addNote('t1', 'pref', 'concise answers');
    s.addNote('t1', 'pref', 'also: no emojis');
    s.addNote('t2', 'pref', 'other thread');
    expect(s.listNotes('t1', 'pref')).toHaveLength(2);
    expect(s.removeNotes('t1', 'pref')).toBe(2);
    expect(s.listNotes('t1')).toHaveLength(0);
    expect(s.listNotes('t2')).toHaveLength(1);
  });
});
