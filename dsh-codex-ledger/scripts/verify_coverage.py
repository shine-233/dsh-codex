#!/usr/bin/env python3
"""Verify exact-revision Cargo inventory against the revision-aware ledger."""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--upstream', required=True)
parser.add_argument('--revision')
args = parser.parse_args()
repo = pathlib.Path(args.upstream)
root = pathlib.Path(__file__).parent.parent
coverage = json.loads((root / 'coverage.json').read_text(encoding='utf-8'))
provenance = json.loads((root / 'inventory-provenance.json').read_text(encoding='utf-8'))
revision = args.revision or coverage['meta']['anchor_commit']


def git(*parts, check=True):
    return subprocess.run(
        ['git', '-C', str(repo), *parts],
        check=check,
        capture_output=True,
        text=True,
    )


def commit_exists(commit):
    return git('cat-file', '-e', f'{commit}^{{commit}}', check=False).returncode == 0


def is_ancestor(older, newer):
    shallow = repo / '.git' / 'shallow'
    if not shallow.exists():
        return git('merge-base', '--is-ancestor', older, newer, check=False).returncode == 0
    with tempfile.NamedTemporaryFile() as empty_shallow:
        env = dict(os.environ, GIT_SHALLOW_FILE=empty_shallow.name)
        return subprocess.run(
            ['git', '-C', str(repo), 'merge-base', '--is-ancestor', older, newer],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        ).returncode == 0


def present_at(path, revision):
    record = provenance.get('paths', {}).get(path)
    if record is None:
        return True
    for epoch in record.get('presenceEpochs', []):
        added = epoch.get('addedAt')
        removed = epoch.get('removedAt')
        after_add = added is None or is_ancestor(added, revision)
        before_remove = removed is None or not is_ancestor(removed, revision)
        if after_add and before_remove:
            return True
    return False


try:
    if not commit_exists(revision):
        raise RuntimeError(f'commit object unavailable: {revision}')
    tree = git('ls-tree', '-r', '--name-only', revision, '--', 'codex-rs').stdout
except (subprocess.CalledProcessError, RuntimeError) as error:
    detail = getattr(error, 'stderr', '') or getattr(error, 'stdout', '') or str(error)
    print('[FAIL]', f'cannot inspect revision {revision}: {detail.strip()}')
    sys.exit(1)

manifests = {
    pathlib.PurePosixPath(item).parent.relative_to('codex-rs').as_posix()
    for item in tree.splitlines()
    if item.endswith('/Cargo.toml')
}
known = {entry['path'] for entry in coverage['entries']}
expected = {path for path in known if present_at(path, revision)}
problems = []
for path in sorted(manifests - expected):
    problems.append(('NEW-UNREGISTERED', path))
for path in sorted(expected - manifests):
    problems.append(('REGISTERED-BUT-ABSENT', path))
if problems:
    for kind, path in problems:
        print('[FAIL]', kind, path)
    sys.exit(1)
print('[OK]', len(manifests), 'manifests exactly accounted for at revision', revision)
