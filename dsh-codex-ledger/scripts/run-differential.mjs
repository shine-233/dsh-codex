#!/usr/bin/env node
// M6 differential runner skeleton.
// Convention: tasks/<ID>/task.md describes the job; run via each harness config below.
// Usage: node scripts/run-differential.mjs --only T01,T02 [--out reports/]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const only = (args.find(a=>a.startsWith('--only'))?.split('=')[1] ?? '').split(',').filter(Boolean);
const outDir = join(process.cwd(), args.find(a=>a.startsWith('--out'))?.split('=')[1] ?? 'reports');
mkdirSync(outDir,{recursive:true});

const HARNESS_COMMANDS = JSON.parse(
  process.env.DIFF_CONFIG ?? '{}');  // {"codex":{"bin":"codex","args":["exec"]},"dsh":{"bin":"dsh","args":["--profile","headless"]}}

if (!Object.keys(HARNESS_COMMANDS).length) {
  console.error('Set DIFF_CONFIG env, e.g. {"codex":{"bin":"codex","args":["exec"]}}');
  process.exit(2);
}

const taskDir = join(process.cwd(),'tasks');
if (!existsSync(taskDir)) { console.error('no tasks/ directory'); process.exit(2); }

for (const id of readdirSync(taskDir)) {
  if (only.length && !only.includes(id)) continue;
  const t = join(taskDir,id);
  if (!existsSync(join(t,'task.md'))) continue;
  for (const [name,cfg] of Object.entries(HARNESS_COMMANDS)) {
    const res = spawnSync(cfg.bin,[...(cfg.args??[]), '--'],{encoding:'utf8', timeout:600000, input:''});
    writeFileSync(join(outDir,`${id}.${name}.log`), (res.stdout??'')+(res.stderr??''));
    console.log(id,name,'exit',res.status);
  }
}
console.log('reports in',outDir);
