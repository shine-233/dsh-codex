// Port of openai/codex apply-patch V4A format essentials (Apache-2.0).
// Supports: Add File / Delete File / Update File (+ rename), @@ change context,
// ' ' context lines, '-' removals, '+' additions.

export interface HunkLine { kind: 'context'|'remove'|'add'; text: string }
export interface FileChange {
  type: 'UpdateFile' | 'AddFile' | 'DeleteFile';
  path: string;
  moveTo?: string;
  hunks: { changeContext?: string; lines: HunkLine[] }[];
}
export interface Patch { updateFiles: FileChange[]; addFiles: { path: string; lines: string[] }[]; deleteFiles: string[] }

export function parsePatch(text: string): Patch {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !/^\*\*\* Begin Patch\s*$/.test(lines[i])) i++;
  if (i >= lines.length) throw new Error('v4a: missing *** Begin Patch');
  i++;
  const patch: Patch = { updateFiles: [], addFiles: [], deleteFiles: [] };

  const readPath = (line: string, prefix: string): string =>
    line.slice(prefix.length).trim();

  while (i < lines.length && !/^\*\*\* End Patch\s*$/.test(lines[i])) {
    const line = lines[i];
    if (line.startsWith('*** Add File: ')) {
      const path = readPath(line,'*** Add File: '); i++;
      const body: string[] = [];
      while (i < lines.length && !/^\*\*\*/.test(lines[i])) { body.push(lines[i].replace(/^\+/,'')); i++; }
      patch.addFiles.push({ path, lines: body });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      patch.deleteFiles.push(readPath(line,'*** Delete File: ')); i++;
      continue;
    }
    if (line.startsWith('*** Update File: ') || line.startsWith('*** Rename to: ')) {
      // handle both orders: "Update File:" then optional "Rename to:"
      let path = ''; let moveTo: string | undefined;
      if (line.startsWith('*** Update File: ')) path = readPath(line,'*** Update File: ');
      i++;
      if (i < lines.length && lines[i].startsWith('*** Move to: ')) {
        moveTo = readPath(lines[i],'*** Move to: '); i++;
      } else if (i < lines.length && lines[i].startsWith('*** Rename to: ')) {
        moveTo = readPath(lines[i],'*** Rename to: '); i++;
      }
      const hunks: FileChange['hunks'] = [];
      while (i < lines.length && !/^\*\*\*/
        .test(lines[i])) {
        if (lines[i].startsWith('@@')) {
          let ctx = lines[i].slice(2).trim(); if (ctx.startsWith(' ')) ctx = ctx.slice(1);
          i++;
          const hunkLines: HunkLine[] = [];
          while (i < lines.length && !/^(@@|\*\*\*)/.test(lines[i])) {
            const l = lines[i];
            if (l.startsWith('+')) hunkLines.push({kind:'add', text:l.slice(1)});
            else if (l.startsWith('-')) hunkLines.push({kind:'remove', text:l.slice(1)});
            else hunkLines.push({kind:'context', text:l.startsWith(' ') ? l.slice(1) : l});
            i++;
          }
          hunks.push({ changeContext: ctx || undefined, lines: hunkLines });
        } else i++;
      }
      patch.updateFiles.push({ type:'UpdateFile', path, moveTo, hunks });
      continue;
    }
    i++;
  }
  return patch;
}

export interface ApplyResult { file: string; status: 'applied'; movedTo?: string }

/**
 * Apply parsed patch against an in-memory file map.
 * Returns the new file map plus per-file results. Uses exact then fuzzy
 * location via consumer-provided locator (wire in codex-edit-fusion seekSequence).
 */
export function applyPatch(
  patch: Patch,
  files: Map<string, string>,
  locate?: (lines: string[], pattern: string[], start: number, eof: boolean) => number | null,
): { files: Map<string,string>; results: ApplyResult[]; errors: string[] } {
  const out = new Map(files);
  const results: ApplyResult[] = []; const errors: string[] = [];
  const getLines = (p: string): string[] | null => {
    const c = out.get(p); return c === undefined ? null : c.split('\n');
  };
  const setLines = (p: string, l: string[]) => { out.set(p, l.join('\n')); };

  for (const del of patch.deleteFiles) {
    if (!out.has(del)) errors.push(`delete target missing: ${del}`);
    else { out.delete(del); results.push({ file: del, status:'applied' }); }
  }
  for (const add of patch.addFiles) {
    if (out.has(add.path)) errors.push(`add target already exists: ${add.path}`);
    else { out.set(add.path, add.lines.join('\n')); results.push({ file:add.path, status:'applied' }); }
  }
  for (const upd of patch.updateFiles) {
    const cur = getLines(upd.path);
    if (cur === null) { errors.push(`update target missing: ${upd.path}`); continue; }
    for (const hunk of upd.hunks) {
      const removePat = hunk.lines.filter((l)=>l.kind==='remove'||l.kind==='context')
                                   .map((l)=>l.text);
      const anchorIdx = (()=>{
        if (locate) {
          const r = locate(cur, removePat, 0, false);
          if (r !== null) return r;
          return null;
        }
        for (let s=0; s<=cur.length-removePat.length; s++) {
          let ok=true;
          for (let j=0;j<removePat.length;j++) if (cur[s+j].trim()!==removePat[j].trim()){ok=false;break;}
          if (ok) return s;
        }
        return null;
      })();
      if (anchorIdx === null && removePat.length>0) { errors.push(`hunk not found in ${upd.path}`); continue; }
      const base = removePat.length===0 ? cur.length : anchorIdx!;
      const kept = cur.slice(0, base);
      const tail = cur.slice(base + removePat.length);
      const rebuilt: string[] = [];
      for (const l of hunk.lines) {
        if (l.kind==='remove') continue;
        if (l.kind==='context') rebuilt.push(cur[base + hunk.lines.filter((x,idx)=>x.kind==='context'&&idx < hunk.lines.indexOf(l)).length] ?? l.text);
        else rebuilt.push(l.text);
      }
      setLines(upd.path, [...kept, ...rebuilt, ...tail]);
    }
    const finalPath = upd.moveTo ?? upd.path;
    if (upd.moveTo) { out.set(upd.moveTo, out.get(upd.path)!); out.delete(upd.path); }
    results.push({ file: finalPath, status:'applied', movedTo: upd.moveTo });
  }
  return { files: out, results, errors };
}
