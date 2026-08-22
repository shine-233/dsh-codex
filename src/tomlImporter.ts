// Minimal TOML subset reader sufficient for codex config.toml shapes:
// top-level keys, [section] tables, strings/numbers/booleans/arrays-of-scalars.
import { existsSync, readFileSync } from 'node:fs';

export function parseTomlLite(src: string): Record<string, any> {
  const out: Record<string, any> = {}; let section = out;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = out[sec[1]] ||= {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    let v: any = kv[2].trim();
    if (v.startsWith('"')) v = v.slice(1, -1);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v.startsWith('[')) v = v.slice(1,-1).split(',').map((s)=>s.trim().replace(/^"|"$/g,'')).filter(Boolean);
    section[kv[1]] = v;
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
