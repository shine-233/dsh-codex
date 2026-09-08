// Bounded TOML reader for codex config shapes: tables, quoted values, arrays,
// inline tables, comments outside strings, and basic numeric/boolean scalars.
import { existsSync, readFileSync } from 'node:fs';

export function parseTomlLite(src: string): Record<string, any> {
  const out: Record<string, any> = {}; let section = out;
  const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const parseBarePath = (raw: string): string[] | null => {
    const parts = raw.split('.').map((part) => part.trim());
    return parts.length > 0 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part) && !blockedKeys.has(part)) ? parts : null;
  };
  const assignPath = (target: Record<string, any>, parts: string[], value: any): boolean => {
    let parent = target;
    for (const part of parts.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(parent, part)) parent[part] = {};
      const child = parent[part];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) return false;
      parent = child;
    }
    parent[parts[parts.length - 1]] = value;
    return true;
  };
  const resolveTable = (parts: string[]): Record<string, any> | null => {
    let table = out;
    for (const part of parts) {
      if (!Object.prototype.hasOwnProperty.call(table, part)) table[part] = {};
      const child = table[part];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) return null;
      table = child;
    }
    return table;
  };
  const stripComment = (line: string): string => {
    let quote: '"' | "'" | null = null; let escaped = false; let out = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote === '"' && escaped) { escaped = false; out += c; continue }
      if (quote === '"' && c === '\\') { escaped = true; out += c; continue }
      if ((c === '"' || c === "'") && quote === null) { quote = c; out += c; continue }
      if (c === quote) { quote = null; out += c; continue }
      if (c === '#' && quote === null) {
        const newline = line.indexOf('\n', i);
        if (newline < 0) break;
        out += '\n'; i = newline;
        continue;
      }
      out += c;
    }
    return out;
  };
  const splitTopLevel = (value: string, separator = ','): string[] => {
    const parts: string[] = []; let start = 0; let depth = 0; let quote: string | null = null; let escaped = false;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (quote === '"' && escaped) { escaped = false; continue }
      if (quote === '"' && c === '\\') { escaped = true; continue }
      if ((c === '"' || c === "'") && quote === null) { quote = c; continue }
      if (c === quote) { quote = null; continue }
      if (quote === null && (c === '[' || c === '{')) depth++;
      else if (quote === null && (c === ']' || c === '}')) depth--;
      else if (quote === null && c === separator && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1 }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  };
  const parseValue = (rawValue: string): any => {
    const value = rawValue.trim();
    if (value.startsWith('"""') && value.endsWith('"""')) {
      const body = value.slice(3, -3);
      return body.replace(/\\([\\"nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' } as any)[c] ?? c);
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const body = value.slice(1, -1);
      return value[0] === '"' ? body.replace(/\\([\\"nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' } as any)[c] ?? c) : body;
    }
    if (value === 'true' || value === 'false') return value === 'true';
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
    if (value.startsWith('[') && value.endsWith(']')) return splitTopLevel(value.slice(1, -1)).map(parseValue);
    if (value.startsWith('{') && value.endsWith('}')) {
      const table: Record<string, any> = {};
      for (const pair of splitTopLevel(value.slice(1, -1))) {
        const eq = pair.indexOf('='); if (eq < 0) continue;
        const parts = parseBarePath(pair.slice(0, eq));
        if (parts) assignPath(table, parts, parseValue(pair.slice(eq + 1)));
      }
      return table;
    }
    return value;
  };
  // Join TOML multiline basic strings before parsing logical lines.
  const logicalLines: string[] = [];
  let pending = '';
  for (const raw of src.split(/\r?\n/)) {
    pending = pending ? `${pending}\n${raw}` : raw;
    const tripleCount = (pending.match(/(?<!\\)"""/g) ?? []).length;
    if (tripleCount % 2 === 0) { logicalLines.push(pending); pending = ''; }
  }
  if (pending) logicalLines.push(pending);
  for (const raw of logicalLines) {
    const line = stripComment(raw).trim();
    if (!line || line.startsWith('#')) continue;
    const arraySec = line.match(/^\[\[(.+)\]\]$/);
    if (arraySec) {
      const parts = parseBarePath(arraySec[1]);
      if (!parts) continue;
      let parent = out;
      for (const part of parts.slice(0, -1)) {
        if (!Object.prototype.hasOwnProperty.call(parent, part)) parent[part] = {};
        const child = parent[part];
        if (typeof child !== 'object' || child === null || Array.isArray(child)) { parent = {}; break }
        parent = child;
      }
      const key = parts[parts.length - 1];
      const arr = Array.isArray(parent[key]) ? parent[key] : (parent[key] = []);
      section = {}; arr.push(section);
      continue;
    }
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      const parts = parseBarePath(sec[1]);
      const table = parts && resolveTable(parts);
      if (table) section = table;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+(?:\s*\.\s*[A-Za-z0-9_-]+)*)\s*=\s*([\s\S]+)$/);
    if (!kv) continue;
    const parts = parseBarePath(kv[1]);
    if (parts) assignPath(section, parts, parseValue(kv[2]));
  }
  return out;
}

/** Emit a cordis.patch.yml that overrides dsh llm route settings from codex config. */
export function tomlToCordisPatch(cfgPath: string): string | null {
  if (!existsSync(cfgPath)) return null;
  const cfg = parseTomlLite(readFileSync(cfgPath,'utf8'));
  const lines: string[] = [];
  const model = cfg['model']; const provider = cfg['model_provider'];
  if (model || provider) lines.push('- insert:');
  if (provider) lines.push(`  - id: llm-route\n    config:\n      model: ${JSON.stringify(model ?? '')}\n      providerHint: ${JSON.stringify(provider)}`);
  const mp = cfg['model_providers'];
  if (mp && typeof mp === 'object' && !Array.isArray(mp)) {
    for (const [pid, pv] of Object.entries<any>(mp)) {
      const base = pv?.base_url ?? '';
      if (base) lines.push(`  - id: llm-provider-${pid}\n    config:\n      baseURL: ${JSON.stringify(base)}`);
    }
  }
  return lines.length ? lines.join('\n')+'\n' : '# codex config had no mappable keys\n';
}
