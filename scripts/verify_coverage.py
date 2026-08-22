#!/usr/bin/env python3
"""Re-scan upstream codex checkout and verify against coverage.json."""
import argparse, pathlib, json, sys
ap=argparse.ArgumentParser(); ap.add_argument('--upstream',required=True)
a=ap.parse_args()
root=pathlib.Path(a.upstream)/'codex-rs'
cov=json.load(open(pathlib.Path(__file__).parent.parent/'coverage.json',encoding='utf-8'))
known={e['path']:e for e in cov['entries']}
man={p.parent.relative_to(root).as_posix() for p in root.rglob('Cargo.toml')}
bad=[]
for m in sorted(man):
    if m not in known: bad.append(('NEW-UNREGISTERED',m))
for p,e in known.items():
    if e['dest'].startswith('EXCLUDED'): continue
    if not (root/p).exists(): bad.append(('MISSING-BUT-PORTED',p))
if bad:
    for t,p in bad: print('[FAIL]',t,p)
    sys.exit(1)
print('[OK]',len(man),'manifests all accounted for; anchor',cov['meta']['anchor_commit'])
