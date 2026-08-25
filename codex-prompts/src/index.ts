import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** List all vendored prompt templates by relative path. */
export function listTemplates(): string[] {
  const out: string[] = [];
  const walk = (dir: string, pre: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, pre ? pre+'/'+e : e);
      else if (e.endsWith('.md')) out.push(pre ? pre+'/'+e : e);
    }
  };
  walk(ROOT, '');
  return out.sort();
}

/** Load one template's raw text. */
export function loadTemplate(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

/** Concatenate selected templates, substituting {{key}} placeholders. */
export function buildSystemPrompt(relPaths: string[], vars: Record<string,string> = {}): string {
  return relPaths.map(p => loadTemplate(p)).join('\n\n')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '{{'+k+'}}');
}
