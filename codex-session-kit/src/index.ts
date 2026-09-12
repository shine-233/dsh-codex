import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeOptionalGitRemoteUrl } from './sanitizedGitUrl.js';

export interface SessionFileMeta { file: string; id?: string; sizeBytes: number }
export interface RolloutParse { header: any | null; items: any[]; badLines: number }

function sanitizeRolloutHeader(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const header = value as Record<string, any>;
  const payload = header.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return value;
  const gitKey = payload.git && typeof payload.git === 'object' && !Array.isArray(payload.git)
    ? 'git'
    : payload.git_info && typeof payload.git_info === 'object' && !Array.isArray(payload.git_info)
      ? 'git_info'
      : undefined;
  if (!gitKey) return value;
  const git = payload[gitKey] as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(git, 'repository_url')) return value;
  const repositoryUrl = sanitizeOptionalGitRemoteUrl(git.repository_url);
  const sanitizedGit = { ...git };
  if (repositoryUrl === undefined) delete sanitizedGit.repository_url;
  else sanitizedGit.repository_url = repositoryUrl;
  return { ...header, payload: { ...payload, [gitKey]: sanitizedGit } };
}

/** List *.jsonl session files under a codex sessions dir (tolerant of junk files). */
export function listSessions(dir: string): SessionFileMeta[] {
  if (!existsSync(dir)) return [];
  const out: SessionFileMeta[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const full = join(dir, f);
    let id: string | undefined;
    try {
      const first = readFileSync(full, 'utf8').split('\n')[0];
      const j = JSON.parse(first);
      id = j?.payload?.id ?? j?.id;
    } catch { /* tolerate unreadable headers */ }
    out.push({ file: full, id, sizeBytes: statSync(full).size });
  }
  return out.sort((a,b)=>b.sizeBytes-a.sizeBytes);
}

/** Line-by-line tolerant parse of a rollout JSONL file (counts bad lines instead of failing). */
export function parseRolloutFile(path: string): RolloutParse {
  const text = readFileSync(path, 'utf8');
  return parseRolloutText(text);
}

export function parseRolloutText(text: string): RolloutParse {
  let header: any = null; const items: any[] = []; let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (!header && (j?.type === 'session_header' || j?.type === 'session_meta')) {
        header = sanitizeRolloutHeader(j);
      }
      else items.push(j);
    } catch { badLines++; }
  }
  return { header, items, badLines };
}

/** Normalize parsed items into a minimal event shape shared across sources. */
export function toDshEvents(items: any[]): { type: string; payload: any }[] {
  return items.map((i) => ({ type: String(i?.type ?? 'unknown'), payload: i }));
}

/** Append-only key/value memory store (JSONL audit log + rebuilt state). */
export class MemoryStore {
  private state = new Map<string, unknown>();
  constructor(private filePath: string) { this.rebuild(); }
  private rebuild() {
    this.state.clear();
    if (!existsSync(this.filePath)) return;
    for (const line of readFileSync(this.filePath,'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const op = JSON.parse(line);
        if (op.op==='set') this.state.set(op.key, op.value);
        if (op.op==='del') this.state.delete(op.key);
      } catch { /* skip bad lines */ }
    }
  }
  private log(op: object) {
    if (!existsSync(join(this.filePath,'..'))) mkdirSync(join(this.filePath,'..'),{recursive:true});
    writeFileSync(this.filePath, JSON.stringify(op)+'\n', {flag:'a'});
  }
  set(key: string, value: unknown) { this.log({op:'set',key,value,ts:Date.now()}); this.state.set(key,value); }
  get(key: string): unknown { return this.state.get(key); }
  has(key: string): boolean { return this.state.has(key); }
  delete(key: string): void { this.log({op:'del',key,ts:Date.now()}); this.state.delete(key); }
  keys(): string[] { return [...this.state.keys()]; }
}
export { SessionIndex, type IndexedSession } from './sessionIndex.js';
export * from './claudeCode.js';
export * from './sanitizedGitUrl.js';
export * from './subagentRoster.js';
