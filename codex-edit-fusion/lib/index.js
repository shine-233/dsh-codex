// src/dsh-plugin.ts
import { readFile, writeFile, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

// src/v4aParser.ts
function parsePatch(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !/^\*\*\* Begin Patch\s*$/.test(lines[i])) i++;
  if (i >= lines.length) throw new Error("v4a: missing *** Begin Patch");
  i++;
  const patch = { updateFiles: [], addFiles: [], deleteFiles: [] };
  const readPath = (line, prefix) => line.slice(prefix.length).trim();
  let ended = false;
  while (i < lines.length && !/^\*\*\* End Patch\s*$/.test(lines[i])) {
    const line = lines[i];
    if (line.startsWith("*** Add File: ")) {
      const path = readPath(line, "*** Add File: ");
      i++;
      if (!path) throw new Error("v4a: add file path is empty");
      const body = [];
      while (i < lines.length && !/^\*\*\*/.test(lines[i])) {
        body.push(lines[i].replace(/^\+/, ""));
        i++;
      }
      if (body.some((entry, index) => lines[i - body.length + index]?.startsWith("+") !== true)) {
        throw new Error(`v4a: malformed add file body for ${path}`);
      }
      patch.addFiles.push({ path, lines: body });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      const path = readPath(line, "*** Delete File: ");
      if (!path) throw new Error("v4a: delete file path is empty");
      patch.deleteFiles.push(path);
      i++;
      continue;
    }
    if (line.startsWith("*** Update File: ") || line.startsWith("*** Rename to: ")) {
      let path = "";
      let moveTo;
      if (line.startsWith("*** Update File: ")) path = readPath(line, "*** Update File: ");
      if (!path) throw new Error("v4a: update file path is empty");
      i++;
      if (i < lines.length && lines[i].startsWith("*** Move to: ")) {
        moveTo = readPath(lines[i], "*** Move to: ");
        i++;
      } else if (i < lines.length && lines[i].startsWith("*** Rename to: ")) {
        moveTo = readPath(lines[i], "*** Rename to: ");
        i++;
      }
      const hunks = [];
      while (i < lines.length && !/^\*\*\*/.test(lines[i])) {
        if (lines[i].startsWith("@@")) {
          let ctx = lines[i].slice(2).trim();
          if (ctx.startsWith(" ")) ctx = ctx.slice(1);
          i++;
          const hunkLines = [];
          while (i < lines.length && !/^(@@|\*\*\*)/.test(lines[i])) {
            const l = lines[i];
            if (l.startsWith("+")) hunkLines.push({ kind: "add", text: l.slice(1) });
            else if (l.startsWith("-")) hunkLines.push({ kind: "remove", text: l.slice(1) });
            else hunkLines.push({ kind: "context", text: l.startsWith(" ") ? l.slice(1) : l });
            i++;
          }
          hunks.push({ changeContext: ctx || void 0, lines: hunkLines });
          if (i < lines.length && /^\*\*\* End of File\s*$/.test(lines[i])) {
            hunks[hunks.length - 1].eof = true;
            i++;
          }
        } else i++;
      }
      if (hunks.length === 0 && !moveTo) throw new Error(`v4a: update file has no hunks: ${path}`);
      patch.updateFiles.push({ type: "UpdateFile", path, moveTo, hunks });
      continue;
    }
    throw new Error(`v4a: unexpected directive: ${line}`);
  }
  if (i < lines.length && /^\*\*\* End Patch\s*$/.test(lines[i])) ended = true;
  if (!ended) throw new Error("v4a: missing *** End Patch");
  return patch;
}
function applyPatch(patch, files, locate) {
  const original = new Map(files);
  const out = new Map(files);
  const results = [];
  const errors = [];
  const lineEndings = /* @__PURE__ */ new Map();
  for (const [path, content] of files) lineEndings.set(path, content.includes("\r\n") ? "\r\n" : "\n");
  const getLines = (p) => {
    const c = out.get(p);
    return c === void 0 ? null : c.split(/\r\n|\n/);
  };
  const setLines = (p, l) => {
    const eol = lineEndings.get(p) ?? "\n";
    out.set(p, l.join(eol));
  };
  for (const del of patch.deleteFiles) {
    if (!out.has(del)) errors.push(`delete target missing: ${del}`);
    else {
      out.delete(del);
      results.push({ file: del, status: "applied" });
    }
  }
  for (const add of patch.addFiles) {
    if (out.has(add.path)) errors.push(`add target already exists: ${add.path}`);
    else {
      out.set(add.path, add.lines.join("\n"));
      results.push({ file: add.path, status: "applied" });
    }
  }
  for (const upd of patch.updateFiles) {
    let cur = getLines(upd.path);
    if (cur === null) {
      errors.push(`update target missing: ${upd.path}`);
      continue;
    }
    for (const hunk of upd.hunks) {
      const removePat = hunk.lines.filter((l) => l.kind === "remove" || l.kind === "context").map((l) => l.text);
      const anchorIdx = (() => {
        if (locate) {
          const r = locate(cur, removePat, 0, Boolean(hunk.eof));
          if (r !== null) return r;
          return null;
        }
        for (let s = 0; s <= cur.length - removePat.length; s++) {
          let ok = true;
          for (let j = 0; j < removePat.length; j++) if (cur[s + j].trim() !== removePat[j].trim()) {
            ok = false;
            break;
          }
          if (ok) return s;
        }
        return null;
      })();
      if (anchorIdx === null && removePat.length > 0) {
        errors.push(`hunk not found in ${upd.path}`);
        continue;
      }
      const base = removePat.length === 0 ? cur.length : anchorIdx;
      const kept = cur.slice(0, base);
      const tail = cur.slice(base + removePat.length);
      const rebuilt = [];
      let consumed = 0;
      for (const l of hunk.lines) {
        if (l.kind === "remove") {
          consumed++;
          continue;
        }
        if (l.kind === "context") {
          rebuilt.push(cur[base + consumed] ?? l.text);
          consumed++;
        } else rebuilt.push(l.text);
      }
      cur = [...kept, ...rebuilt, ...tail];
      setLines(upd.path, cur);
    }
    if (upd.moveTo && upd.moveTo !== upd.path && out.has(upd.moveTo)) {
      errors.push(`move target already exists: ${upd.moveTo}`);
      continue;
    }
    const finalPath = upd.moveTo ?? upd.path;
    if (upd.moveTo) {
      out.set(upd.moveTo, out.get(upd.path));
      out.delete(upd.path);
    }
    results.push({ file: finalPath, status: "applied", movedTo: upd.moveTo });
  }
  if (errors.length > 0) return { files: original, results: [], errors };
  return { files: out, results, errors };
}

// src/seekSequence.ts
var DASHES = ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"];
var SINGLE_QUOTES = ["\u2018", "\u2019", "\u201A", "\u201B"];
var DOUBLE_QUOTES = ["\u201C", "\u201D", "\u201E", "\u201F"];
var ODD_SPACES = ["\xA0", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200A", "\u202F", "\u205F", "\u3000"];
function normalise(s) {
  return Array.from(s.trim()).map((c) => {
    if (DASHES.includes(c)) return "-";
    if (SINGLE_QUOTES.includes(c)) return "'";
    if (DOUBLE_QUOTES.includes(c)) return '"';
    if (ODD_SPACES.includes(c)) return " ";
    return c;
  }).join("");
}
function seekSequence(lines, pattern, start, eof = false, updateFileMode = "PreserveLineEndings") {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;
  const attempt = (searchStart) => {
    const last = lines.length - pattern.length;
    const rowMatches = (i, eq) => {
      for (let j = 0; j < pattern.length; j++) {
        if (!eq(lines[i + j], pattern[j])) return false;
      }
      return true;
    };
    for (let i = searchStart; i <= last; i++) {
      if (rowMatches(i, (a, b) => a === b)) return i;
    }
    for (let i = searchStart; i <= last; i++) {
      if (rowMatches(i, (a, b) => a.replace(/\s+$/, "") === b.replace(/\s+$/, ""))) return i;
    }
    for (let i = searchStart; i <= last; i++) {
      if (rowMatches(i, (a, b) => a.trim() === b.trim())) return i;
    }
    for (let i = searchStart; i <= last; i++) {
      if (rowMatches(i, (a, b) => normalise(a) === normalise(b))) return i;
    }
    return null;
  };
  const eofStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : null;
  const primary = eofStart === null ? start : updateFileMode === "NormalizeToLf" ? eofStart : Math.max(eofStart, start);
  const anchored = attempt(primary);
  if (anchored !== null) return anchored;
  if (primary !== start) return attempt(start);
  return null;
}

// src/dsh-plugin.ts
var name = "codex-edit-fusion";
var inject = ["tools"];
function touchedPaths(patch) {
  const paths = /* @__PURE__ */ new Set();
  for (const u of patch.updateFiles) {
    paths.add(u.path);
    if (u.moveTo) paths.add(u.moveTo);
  }
  for (const a of patch.addFiles) paths.add(a.path);
  for (const d of patch.deleteFiles) paths.add(d);
  return [...paths];
}
function apply(ctx, config = {}) {
  if (!ctx?.tools?.register) return;
  const defineTool = (d) => d;
  const root = typeof config.root === "string" && config.root ? config.root : void 0;
  ctx.tools.register(defineTool({
    name: "codex_apply_patch",
    description: "Apply an openai/codex V4A patch (*** Begin Patch ... Update/Add/Delete File ...) to files under the working directory. Fuzzy context matching with atomic per-file writes.",
    parameters: {
      patch: { type: "string", required: true, description: "full V4A patch text beginning with *** Begin Patch" },
      cwd: { type: "string", description: "base directory for relative paths; defaults to process.cwd()" }
    },
    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
    async execute(args) {
      const configuredRoot = root ?? process.cwd();
      const base = resolve(isAbsolute(String(args?.cwd ?? "")) ? String(args.cwd) : join(configuredRoot, String(args?.cwd ?? ".")));
      const patch = parsePatch(String(args?.patch ?? ""));
      const files = /* @__PURE__ */ new Map();
      for (const p of touchedPaths(patch)) {
        try {
          files.set(p, await readFile(join(base, p), "utf8"));
        } catch {
        }
      }
      const res = applyPatch(patch, files, (lines, pattern, start) => seekSequence(lines, pattern, start));
      if (res.errors.length > 0) return JSON.stringify({ applied: [], errors: res.errors }, null, 2);
      const touched = touchedPaths(patch);
      try {
        for (const [p, content] of res.files) {
          if (content === files.get(p)) continue;
          await writeFile(join(base, p), content, "utf8");
        }
        for (const upd of patch.updateFiles) {
          if (!upd.moveTo || upd.moveTo === upd.path) continue;
          await rm(join(base, upd.path), { force: true });
        }
        for (const del of patch.deleteFiles) await rm(join(base, del), { force: true });
      } catch (error) {
        for (const p of touched) {
          try {
            if (files.has(p)) await writeFile(join(base, p), files.get(p), "utf8");
            else await rm(join(base, p), { force: true });
          } catch {
          }
        }
        return JSON.stringify({ applied: [], errors: [`write transaction failed: ${String(error)}`] }, null, 2);
      }
      return JSON.stringify({ applied: res.results, errors: [] }, null, 2);
    },
    timeoutMs: 15e3
  }));
}
export {
  apply,
  applyPatch,
  inject,
  name,
  parsePatch,
  seekSequence
};
