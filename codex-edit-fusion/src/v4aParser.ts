// Port of openai/codex apply-patch V4A format essentials (Apache-2.0).
// Supports: Add File / Delete File / Update File (+ rename), @@ change context,
// ' ' context lines, '-' removals, '+' additions.

export interface HunkLine { kind: 'context'|'remove'|'add'; text: string }
export interface FileChange {
  type: 'UpdateFile' | 'AddFile' | 'DeleteFile';
  path: string;
  moveTo?: string;
  hunks: { changeContext?: string; lines: HunkLine[]; eof?: boolean }[];
}
export interface Patch { updateFiles: FileChange[]; addFiles: { path: string; lines: string[] }[]; deleteFiles: string[] }

// Upstream apply-patch tolerates surrounding whitespace on marker and
// directive lines (scenarios 017/018/020 pad them with leading or trailing
// spaces). Body lines must NOT be trimmed - their leading +/-/space is data.
const DIRECTIVE = /^\s*\*\*\*/;
const BEGIN_PATCH = /^\s*\*\*\* Begin Patch\s*$/;
const END_PATCH = /^\s*\*\*\* End Patch\s*$/;
const END_OF_FILE = /^\s*\*\*\* End of File\s*$/;
const HUNK_OR_DIRECTIVE = /^\s*(@@|\*\*\*)/;

export function parsePatch(text: string): Patch {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !BEGIN_PATCH.test(lines[i])) i++;
  if (i >= lines.length) throw new Error('v4a: missing *** Begin Patch');
  i++;
  const patch: Patch = { updateFiles: [], addFiles: [], deleteFiles: [] };

  const readPath = (line: string, prefix: string): string =>
    line.slice(prefix.length).trim();

  let ended = false;
  while (i < lines.length && !END_PATCH.test(lines[i])) {
    const line = lines[i].trim();
    if (line.startsWith('*** Add File: ')) {
      const path = readPath(line,'*** Add File: '); i++;
      if (!path) throw new Error('v4a: add file path is empty');
      const body: string[] = [];
      while (i < lines.length && !DIRECTIVE.test(lines[i])) { body.push(lines[i].replace(/^\+/,'')); i++; }
      if (body.some((entry, index) => lines[i - body.length + index]?.startsWith('+') !== true)) {
        throw new Error(`v4a: malformed add file body for ${path}`);
      }
      patch.addFiles.push({ path, lines: body });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      const path = readPath(line,'*** Delete File: ');
      if (!path) throw new Error('v4a: delete file path is empty');
      patch.deleteFiles.push(path); i++;
      continue;
    }
    if (line.startsWith('*** Update File: ') || line.startsWith('*** Rename to: ')) {
      // handle both orders: "Update File:" then optional "Rename to:"
      let path = ''; let moveTo: string | undefined;
      if (line.startsWith('*** Update File: ')) path = readPath(line,'*** Update File: ');
      if (!path) throw new Error('v4a: update file path is empty');
      i++;
      const follow = i < lines.length ? lines[i].trim() : '';
      if (follow.startsWith('*** Move to: ')) {
        moveTo = readPath(follow,'*** Move to: '); i++;
      } else if (follow.startsWith('*** Rename to: ')) {
        moveTo = readPath(follow,'*** Rename to: '); i++;
      }
      const hunks: FileChange['hunks'] = [];
      while (i < lines.length && !DIRECTIVE.test(lines[i])) {
        if (lines[i].trimStart().startsWith('@@')) {
          let ctx = lines[i].trimStart().slice(2).trim(); if (ctx.startsWith(' ')) ctx = ctx.slice(1);
          i++;
          const hunkLines: HunkLine[] = [];
          while (i < lines.length && !HUNK_OR_DIRECTIVE.test(lines[i])) {
            const l = lines[i];
            if (l.startsWith('+')) hunkLines.push({kind:'add', text:l.slice(1)});
            else if (l.startsWith('-')) hunkLines.push({kind:'remove', text:l.slice(1)});
            else hunkLines.push({kind:'context', text:l.startsWith(' ') ? l.slice(1) : l});
            i++;
          }
          hunks.push({ changeContext: ctx || undefined, lines: hunkLines });
          if (i < lines.length && END_OF_FILE.test(lines[i])) {
            (hunks[hunks.length - 1] as { changeContext?: string; lines: HunkLine[]; eof?: boolean }).eof = true;
            i++;
          }
        } else i++;
      }
      if (hunks.length === 0 && !moveTo) throw new Error(`v4a: update file has no hunks: ${path}`);
      patch.updateFiles.push({ type:'UpdateFile', path, moveTo, hunks });
      continue;
    }
    throw new Error(`v4a: unexpected directive: ${line}`);
  }
  if (i < lines.length && END_PATCH.test(lines[i])) ended = true;
  if (!ended) throw new Error('v4a: missing *** End Patch');
  // Upstream rejects a patch that carries no operation at all (scenario 005).
  if (!patch.updateFiles.length && !patch.addFiles.length && !patch.deleteFiles.length) {
    throw new Error('v4a: patch contains no file operations');
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
  // Stage every operation in an isolated map. The caller only receives the
  // staged map when the complete patch validates; this prevents partial
  // application when a later hunk/file fails.
  const original = new Map(files);
  const out = new Map(files);
  const results: ApplyResult[] = []; const errors: string[] = [];
  const lineEndings = new Map<string, string>();
  for (const [path, content] of files) lineEndings.set(path, content.includes('\r\n') ? '\r\n' : '\n');
  const getLines = (p: string): string[] | null => {
    const c = out.get(p); return c === undefined ? null : c.split(/\r\n|\n/);
  };
  // Upstream apply-patch always leaves files newline-terminated (scenarios
  // 001/002/016 assert a trailing newline); a file without one is what git
  // reports as "\ No newline at end of file".
  const ensureEol = (content: string, eol: string): string =>
    content.length > 0 && !content.endsWith('\n') ? content + eol : content;
  const setLines = (p: string, l: string[]) => {
    const eol = lineEndings.get(p) ?? '\n';
    out.set(p, ensureEol(l.join(eol), eol));
  };

  for (const del of patch.deleteFiles) {
    if (!out.has(del)) errors.push(`delete target missing: ${del}`);
    else { out.delete(del); results.push({ file: del, status:'applied' }); }
  }
  for (const add of patch.addFiles) {
    if (out.has(add.path)) errors.push(`add target already exists: ${add.path}`);
    else { out.set(add.path, ensureEol(add.lines.join('\n'), '\n')); results.push({ file:add.path, status:'applied' }); }
  }
  for (const upd of patch.updateFiles) {
    let cur = getLines(upd.path);
    if (cur === null) { errors.push(`update target missing: ${upd.path}`); continue; }
    for (const hunk of upd.hunks) {
      const removePat = hunk.lines.filter((l)=>l.kind==='remove'||l.kind==='context')
                                   .map((l)=>l.text);
      const anchorIdx = (()=>{
        if (locate) {
          const r = locate(cur, removePat, 0, Boolean((hunk as { eof?: boolean }).eof),);
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
      // A pure-addition hunk appends after the last real line. Because the
      // content is split on the trailing newline, the array ends with an empty
      // string; inserting after it would add a blank line (scenario 016).
      const endIndex = cur.length > 0 && cur[cur.length - 1] === '' ? cur.length - 1 : cur.length;
      const base = removePat.length===0 ? endIndex : anchorIdx!;
      const kept = cur.slice(0, base);
      const tail = cur.slice(base + removePat.length);
      const rebuilt: string[] = [];
      let consumed = 0;
      for (const l of hunk.lines) {
        if (l.kind==='remove') { consumed++; continue; }
        if (l.kind==='context') { rebuilt.push(cur[base + consumed] ?? l.text); consumed++; }
        else rebuilt.push(l.text);
      }
      cur = [...kept, ...rebuilt, ...tail];
      setLines(upd.path, cur);
    }
    if (upd.moveTo && upd.moveTo !== upd.path && out.has(upd.moveTo)) {
      errors.push(`move target already exists: ${upd.moveTo}`);
      continue;
    }
    const finalPath = upd.moveTo ?? upd.path;
    if (upd.moveTo) { out.set(upd.moveTo, out.get(upd.path)!); out.delete(upd.path); }
    results.push({ file: finalPath, status:'applied', movedTo: upd.moveTo });
  }
  if (errors.length > 0) return { files: original, results: [], errors };
  return { files: out, results, errors };
}
