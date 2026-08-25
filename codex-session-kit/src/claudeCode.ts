// Importer for Claude Code session JSONL (~/.claude/projects/<proj>/*.jsonl).
// Tolerant reader: each line is an event object; shapes vary across versions.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ClaudeTurn { role: 'user'|'assistant'; text: string; ts?: string }

export function listClaudeProjects(claudeHome: string): string[] {
  const projDir = join(claudeHome, 'projects');
  try { return readdirSync(projDir).map((p)=>join(projDir,p)).filter((p)=>statSync(p).isDirectory()); }
  catch { return []; }
}

export function listClaudeSessions(projectDir: string): string[] {
  try { return readdirSync(projectDir).filter((f)=>f.endsWith('.jsonl')).map((f)=>join(projectDir,f)); }
  catch { return []; }
}

/** Parse one session file into turns; bad lines are skipped and counted. */
export function parseClaudeSession(path: string): { turns: ClaudeTurn[]; skipped: number } {
  const turns: ClaudeTurn[] = []; let skipped = 0;
  for (const line of readFileSync(path,'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const msg = j?.message;
      const text = Array.isArray(msg?.content)
        ? msg.content.filter((c:any)=>c?.type==='text').map((c:any)=>c.text).join('\n')
        : (typeof msg?.content === 'string' ? msg.content : '');
      if (!text) { skipped++; continue; }
      turns.push({ role: j.type==='assistant'?'assistant':'user', text, ts: j.timestamp });
    } catch { skipped++; }
  }
  return { turns, skipped };
}

/** Convert parsed Claude turns into dsh-normalized events. */
export function claudeToDshEvents(turns: ClaudeTurn[]): { type: string; payload: any }[] {
  return turns.map((t)=>({ type: t.role==='assistant' ? 'agent_message' : 'user_message',
                          payload: { text: t.text, ts: t.ts, source: 'claude-code' } }));
}
