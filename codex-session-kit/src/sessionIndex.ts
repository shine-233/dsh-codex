// SQLite query mirror over session files (verdict-7 adoption), Node >=22.5 node:sqlite.
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface IndexedSession { id: string|null; file: string; cwd?: string|null; originator?: string|null }

export class SessionIndex {
  private db: any;
  constructor(dbPath: string) {
    const { DatabaseSync } = req('node:sqlite');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions(
      id TEXT PRIMARY KEY, file TEXT UNIQUE, cwd TEXT, originator TEXT, size_bytes INTEGER)` );
  }

  /** Rebuild the mirror from a sessions directory (idempotent upserts). */
  rebuildFrom(dir: string): number {
    let n = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = join(dir, f);
      let id: string | null = null, cwd: string | null = null, originator: string | null = null;
      try {
        const headerLine = readFileSync(file,'utf8').split('\n')[0];
        const j = JSON.parse(headerLine);
        id = j?.payload?.id ?? j?.id ?? null;
        cwd = j?.payload?.cwd ?? j?.cwd ?? null;
        originator = j?.payload?.originator ?? null;
      } catch { /* keep row with file-only identity */ }
      const size = require('node:fs').statSync(file).size;
      this.db.prepare(`INSERT INTO sessions(id,file,cwd,originator,size_bytes) VALUES(?,?,?,?,?)
        ON CONFLICT(file) DO UPDATE SET id=excluded.id, cwd=excluded.cwd,
        originator=excluded.originator, size_bytes=excluded.size_bytes`)
        .run(id, file, cwd, originator, size);
      n++;
    }
    return n;
  }

  search(q: string): IndexedSession[] {
    const rows = this.db.prepare(
      `SELECT id,file,cwd,originator FROM sessions
       WHERE id LIKE ? OR file LIKE ? OR IFNULL(cwd,'') LIKE ? ORDER BY file`
    ).all('%'+q+'%','%'+q+'%','%'+q+'%') as any[];
    return rows.map((r)=>({ id:r.id??null, file:r.file, cwd:r.cwd??null, originator:r.originator??null }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM sessions').all() as any[])[0]?.c ?? 0;
  }
}

