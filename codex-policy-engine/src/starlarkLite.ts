// Minimal Starlark-subset parser for execpolicy policy files (Apache-2.0 port).
// Supports:
//   prefix_rule(program, [arg, ...] | [[alt,...], ...], ALLOW|FORBIDDEN|PROMPT)
//   network_rule(host, PROTOCOL, ALLOW|FORBIDDEN|PROMPT)
// Lines starting with # are comments. Strings use double quotes.
import type { Decision } from './decision.js';
import type { PatternToken } from './rule.js';

export interface ParsedPolicy {
  prefixRules: { program: string; args: PatternToken[]; decision: Decision }[];
  networkRules: { host: string; protocol: string; decision: Decision }[];
}

const isDecision = (s: string): s is 'ALLOW'|'FORBIDDEN'|'PROMPT' =>
  s==='ALLOW'||s==='FORBIDDEN'||s==='PROMPT';
const normDecision = (s:string): Decision =>
  s==='ALLOW'?'Allow': s==='FORBIDDEN'?'Forbidden':'Prompt';

function tokenize(src: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let s = ''; i++;
      while (i < src.length && src[i] !== c) { s += src[i]; i++; }
      i++; toks.push(JSON.stringify(s)); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) { s += src[i]; i++; }
      toks.push(s); continue;
    }
    if ('[],()'.includes(c)) { toks.push(c); i++; continue; }
    throw new Error('starlark-lite: unexpected char '+JSON.stringify(c));
  }
  return toks;
}

type RawCall = { fn: string; args: string[] };

/** Split top-level items inside outer brackets/parens (depth-1 commas). */
function splitTopLevel(outer: string): string[] {
  const parts: string[] = []; let cur = ''; let depth = 0; let inStr = false; let q = '';
  for (const ch of outer) {
    if (inStr) { cur += ch; if (ch === q) inStr = false; continue; }
    if (ch === '"' || ch === "'") { inStr = true; q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(') { depth++; if (depth === 1) { cur=''; continue; } cur += ch; continue; }
    if (ch === ']' || ch === ')') { depth--; if (depth === 0) { parts.push(cur.trim()); continue; } cur += ch; continue; }
    if (ch === ',' && depth === 1) { parts.push(cur.trim()); cur=''; continue; }
    cur += ch;
  }
  return parts;
}

function parseCalls(toks: string[]): RawCall[] {
  const calls: RawCall[] = [];
  let i = 0;
  while (i < toks.length) {
    if (/^[a-z_]+$/.test(toks[i]) && toks[i+1] === '(') {
      const fn = toks[i]; i += 2;
      const args: string[] = []; let cur = ''; let depth = 0;
      while (i < toks.length) {
        const t = toks[i];
        if (t === ')' && depth === 0) { if (cur) args.push(cur); i++; break; }
        if (t === ',' && depth === 0) { if (cur) args.push(cur); cur=''; i++; continue; }
        if (t === '[' || t === '(') { depth++; cur += t; i++; continue; }
        if (t === ']' || t === ')') { depth--; cur += t; i++; continue; }
        cur += t; i++;
      }
      calls.push({ fn, args });
    } else i++;
  }
  return calls;
}

export function parsePolicyFile(src: string): ParsedPolicy {
  const out: ParsedPolicy = { prefixRules: [], networkRules: [] };
  for (const call of parseCalls(tokenize(src))) {
    if (call.fn === 'prefix_rule') {
      const [progRaw, listRaw, decRaw] = call.args;
      const program = JSON.parse(progRaw);
      const items = splitTopLevel(listRaw).filter((s) => s.length > 0);
      const tokens: PatternToken[] = items.map((item) => {
        const v = JSON.parse(item);
        return Array.isArray(v)
          ? { kind:'Alts', values: v } satisfies PatternToken
          : { kind:'Single', value: String(v) } satisfies PatternToken;
      });
      if (!isDecision(decRaw)) throw new Error('bad decision '+decRaw);
      out.prefixRules.push({ program, args: tokens, decision: normDecision(decRaw) });
    } else if (call.fn === 'network_rule' && call.args.length >= 3) {
      const [hostRaw, proto, decRaw] = call.args;
      const host = JSON.parse(hostRaw);
      if (!isDecision(decRaw)) throw new Error('bad decision '+decRaw);
      out.networkRules.push({ host, protocol: proto, decision: normDecision(decRaw) });
    }
    // unknown functions ignored for forward compatibility
  }
  return out;
}
