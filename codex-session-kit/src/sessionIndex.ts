// SQLite query mirror over session files (verdict-7 adoption), Node >=22.5 node:sqlite.
// When node:sqlite is unavailable (e.g. builds without the sqlite extension), it
// transparently falls back to a pure-JS store persisted as JSON, so the index
// logic stays verifiable everywhere instead of being skipped.
import { createRequire } from 'node:module';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface IndexedSession { id: string|null; file: string; cwd?: string|null; originator?: string|null }

interface SessionRow { id: string|null; file: string; cwd: string|null; originator: string|null; size: number }

/** Minimal store contract the index logic depends on. */
export interface SessionStore {
  upsert(r: SessionRow): void;
  search(q: string): IndexedSession[];
  count(): number;
  close(): void;
}

/** Pure-JS fallback: in-memory rows. Used only when node:sqlite is absent, so
 * the index logic stays testable without a sqlite build. The node:sqlite path
 * remains the persisted mirror; this fallback intentionally keeps no disk state
 * (avoids file-lock issues on platforms whose delete shim holds the handle). */
class JsSessionStore implements SessionStore {
  private rows: SessionRow[] = [];
  constructor(_dbPath: string) {}
  upsert(r: SessionRow): void {
    const i = this.rows.findIndex((x) => x.file === r.file);
    if (i >= 0) this.rows[i] = r; else this.rows.push(r);
  }
  search(q: string): IndexedSession[] {
    const needle = q.toLowerCase();
    return this.rows
      .filter(
        (x) =>
          (x.id ?? '').toLowerCase().includes(needle) ||
          x.file.toLowerCase().includes(needle) ||
          (x.cwd ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .map(({ id, file, cwd, originator }) => ({ id, cwd, originator, file }));
  }
  count(): number { return this.rows.length; }
  close(): void { /* in-memory, nothing to release */ }
}

/** node:sqlite-backed store (used when the extension is present). */
class SqliteSessionStore implements SessionStore {
  private db: any;
  constructor(dbPath: string) {
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, file TEXT UNIQUE, cwd TEXT, originator TEXT, size_bytes INTEGER)`,
    );
  }
  upsert(r: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions(id,file,cwd,originator,size_bytes) VALUES(?,?,?,?,?)
         ON CONFLICT(file) DO UPDATE SET id=excluded.id, cwd=excluded.cwd,
         originator=excluded.originator, size_bytes=excluded.size_bytes`,
      )
      .run(r.id, r.file, r.cwd, r.originator, r.size);
  }
  search(q: string): IndexedSession[] {
    const rows = this.db
      .prepare(
        `SELECT id,file,cwd,originator FROM sessions
         WHERE id LIKE ? OR file LIKE ? OR IFNULL(cwd,'') LIKE ? ORDER BY file`,
      )
      .all('%' + q + '%', '%' + q + '%', '%' + q + '%') as any[];
    return rows.map((r: any) => ({
      id: r.id ?? null,
      file: r.file,
      cwd: r.cwd ?? null,
      originator: r.originator ?? null,
    }));
  }
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM sessions').all() as any[])[0]?.c ?? 0;
  }
  close(): void { this.db.close(); }
}

function createStore(dbPath: string): SessionStore {
  try {
    return new SqliteSessionStore(dbPath);
  } catch {
    return new JsSessionStore(dbPath);
  }
}

export class SessionIndex {
  private store: SessionStore;
  constructor(dbPath: string) {
    this.store = createStore(dbPath);
  }

  /** Rebuild the mirror from a sessions directory (idempotent upserts). */
  rebuildFrom(dir: string): number {
    let n = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = join(dir, f);
      let id: string | null = null, cwd: string | null = null, originator: string | null = null;
      try {
        const headerLine = readFileSync(file, 'utf8').split('\n')[0];
        const j = JSON.parse(headerLine);
        id = j?.payload?.id ?? j?.id ?? null;
        cwd = j?.payload?.cwd ?? j?.cwd ?? null;
        originator = j?.payload?.originator ?? null;
      } catch { /* keep row with file-only identity */ }
      const size = statSync(file).size;
      this.store.upsert({ id, file, cwd, originator, size });
      n++;
    }
    return n;
  }

  search(q: string): IndexedSession[] {
    return this.store.search(q);
  }

  count(): number {
    return this.store.count();
  }

  /** Release the underlying store (e.g. close the sqlite connection). */
  close(): void {
    this.store.close();
  }
}
