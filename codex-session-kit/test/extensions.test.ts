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
    const graph = new AgentGraphStore(file);
    graph.addAgent('parent', 'root');
    graph.addAgent('child', 'sub');
    graph.addSpawnEdge('parent', 'child', 'running');
    graph.setEdgeStatus('child', 'completed');
    const reopened = new AgentGraphStore(file);
    expect(reopened.nodeCount()).toBe(2);
    expect(reopened.childrenOf('parent')[0].status).toBe('completed');
  });

  it('renders persisted direct v2 children with loaded agents first', () => {
    const file = join(tmp, 'v2-roster.jsonl');
    const graph = new AgentGraphStore(file);
    graph.addAgent('parent', 'root', '/root');
    graph.addAgent('unloaded', 'alpha', '/root/alpha');
    graph.addAgent('loaded', 'worker', '/root/worker');
    graph.addAgent('grandchild', 'nested', '/root/worker/nested');
    graph.addSpawnEdge('parent', 'unloaded');
    graph.addSpawnEdge('parent', 'unloaded'); // replayed duplicate edge must not duplicate the roster
    graph.addSpawnEdge('parent', 'loaded');
    graph.addSpawnEdge('loaded', 'grandchild');

    const reopened = new AgentGraphStore(file);
    expect(reopened.formatEnvironmentContextSubagents('parent', ['loaded'])).toBe(
      '<agent name="/root/worker" />\n<agent name="/root/alpha" />',
    );
  });

  it('requires roster edges to target canonical direct-child paths', () => {
    const graph = new AgentGraphStore();
    graph.addAgent('missing-parent-path', 'missing');
    graph.addAgent('parent', 'root', '/root');
    graph.addAgent('child', 'child', '/root/child');
    graph.addAgent('cross-parent', 'cross', '/other/child');
    graph.addAgent('linked-grandchild', 'nested', '/root/child/nested');
    graph.addSpawnEdge('missing-parent-path', 'child');
    graph.addSpawnEdge('parent', 'child');
    graph.addSpawnEdge('parent', 'cross-parent');
    graph.addSpawnEdge('parent', 'linked-grandchild');

    expect(graph.formatEnvironmentContextSubagents('missing-parent-path', [])).toBe('');
    expect(graph.formatEnvironmentContextSubagents('parent', [])).toBe(
      '<agent name="/root/child" />',
    );
  });

  it('charges escaped UTF-8 paths against the exact roster byte envelope', () => {
    const wrapperBytes = Buffer.byteLength('  <subagents>\n  </subagents>\n');
    const renderedBytes = (path: string) => Buffer.byteLength(
      `    <agent name="${path}" />\n`,
    ) + wrapperBytes;
    const escapedPrefix = '/root/&amp;&quot;&lt;&gt;';
    const fittingPath = escapedPrefix + '界'.repeat(316);
    const oversizedPath = fittingPath + 'x';
    expect(renderedBytes(fittingPath)).toBe(1024);
    expect(renderedBytes(oversizedPath)).toBe(1025);

    const graph = new AgentGraphStore();
    graph.addAgent('parent', 'root', '/root');
    graph.addAgent('fits', 'fits', '/root/&"<>界'.replace('界', '界'.repeat(316)));
    graph.addAgent('too-large', 'too large', '/root/&"<>界'.replace('界', '界'.repeat(316) + 'x'));
    graph.addSpawnEdge('parent', 'fits');
    graph.addSpawnEdge('parent', 'too-large');
    expect(graph.formatEnvironmentContextSubagents('parent', [])).toBe(
      `<agent name="${fittingPath}" />`,
    );
  });

  it('caps a v2 roster at eight agents and 1,024 rendered bytes', () => {
    const graph = new AgentGraphStore();
    graph.addAgent('parent', 'root', '/root');
    for (let i = 0; i < 10; i++) {
      const id = `child-${i}`;
      graph.addAgent(id, id, `/root/${String(i).padStart(2, '0')}`);
      graph.addSpawnEdge('parent', id);
    }
    expect(graph.formatEnvironmentContextSubagents('parent', []).split('\n')).toHaveLength(8);

    const longGraph = new AgentGraphStore();
    const longPath = `/root/${'x'.repeat(990)}`;
    longGraph.addAgent('parent', 'root', '/root');
    longGraph.addAgent('too-long', 'too long', longPath);
    longGraph.addAgent('fits', 'fits', '/root/fits');
    longGraph.addSpawnEdge('parent', 'too-long');
    longGraph.addSpawnEdge('parent', 'fits');
    expect(longGraph.formatEnvironmentContextSubagents('parent', [])).toBe(
      '<agent name="/root/fits" />',
    );
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
