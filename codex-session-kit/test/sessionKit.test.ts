import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRolloutFile, MemoryStore } from '../src/index';

const FIX = [
  JSON.stringify({type:'session_header', payload:{id:'sess_123'}}),
  JSON.stringify({type:'response_item', payload:{role:'user', text:'hi'}}),
  'NOT VALID JSON {{{',
  JSON.stringify({type:'event_msg', payload:{ok:true}}),
].join('\n');

describe('rollout reader (tolerant)', () => {
  it('parses good lines, counts bad lines, captures header', () => {
    const dir = mkdtempSync(join(tmpdir(),'sk-'));
    const file = join(dir,'s.jsonl'); writeFileSync(file, FIX);
    const r = parseRolloutFile(file);
    expect(r.header?.payload.id).toBe('sess_123');
    expect(r.items.length).toBe(2);
    expect(r.badLines).toBe(1);
    rmSync(dir,{recursive:true,force:true});
  });
});

describe('MemoryStore', () => {
  it('set/get/has/keys roundtrip persists across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(),'mem-'));
    const file = join(dir,'memory.jsonl');
    const m1 = new MemoryStore(file);
    m1.set('project','pnpm'); m1.set('lang','ts');
    const m2 = new MemoryStore(file);
    expect(m2.get('project')).toBe('pnpm');
    expect(m2.keys().sort()).toEqual(['lang','project']);
    m2.delete('lang');
    expect(new MemoryStore(file).has('lang')).toBe(false);
    rmSync(dir,{recursive:true,force:true});
  });
});

describe('SessionIndex (node:sqlite mirror)', () => {
  it('rebuilds and searches', async () => {
    let DatabaseSync: any;
    try { ({ DatabaseSync } = await import('node:sqlite')); }
    catch { console.warn('node:sqlite unavailable; skipping'); return; }
    const { SessionIndex } = await import('../src/sessionIndex.js');
    const dir = mkdtempSync(join(tmpdir(),'si-'));
    writeFileSync(join(dir,'a.jsonl'), JSON.stringify({type:'session_header',payload:{id:'sess_A',cwd:'C:/work'}})+'\n');
    writeFileSync(join(dir,'b.jsonl'), JSON.stringify({type:'session_header',payload:{id:'sess_B',cwd:'D:/x'}})+'\n');
    const dbFile = join(dir,'index.db');
    const ix = new SessionIndex(dbFile);
    expect(ix.rebuildFrom(dir)).toBe(2);
    expect(ix.count()).toBe(2);
    expect(ix.search('sess_A')[0].cwd).toBe('C:/work');
    rmSync(dir,{recursive:true,force:true});
  });
});

describe('claude-code importer', () => {
  it('parses mixed content lines and skips junk', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(),'cc-'));
    const file = join(dir,'s.jsonl');
    writeFileSync(file, [
      JSON.stringify({type:'user',timestamp:'2026-08-22T10:00:00Z',message:{role:'user',content:'fix the bug'}}),
      JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'on it'}]}}),
      '{broken',
      JSON.stringify({type:'system'}),
    ].join('\n'));
    const { parseClaudeSession, claudeToDshEvents } = await import('../src/index');
    const r = parseClaudeSession(file);
    expect(r.turns.length).toBe(2);
    expect(r.skipped).toBe(2);
    const ev = claudeToDshEvents(r.turns);
    expect(ev[0].type).toBe('user_message');
    expect(ev[1].payload.source).toBe('claude-code');
    rmSync(dir,{recursive:true,force:true});
  });
});
