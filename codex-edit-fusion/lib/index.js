// src/dsh-plugin.ts
import z from "@deepseek-ai/schemastery";
import { FsError } from "@deepseek-ai/dsh-fs";
import { sandboxDenialMarker } from "@deepseek-ai/dsh-sandbox";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/v4aParser.ts
var DIRECTIVE = /^\s*\*\*\*/;
var BEGIN_PATCH = /^\s*\*\*\* Begin Patch\s*$/;
var END_PATCH = /^\s*\*\*\* End Patch\s*$/;
var END_OF_FILE = /^\s*\*\*\* End of File\s*$/;
var HUNK_OR_DIRECTIVE = /^\s*(@@|\*\*\*)/;
function parsePatch(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !BEGIN_PATCH.test(lines[i])) i++;
  if (i >= lines.length) throw new Error("v4a: missing *** Begin Patch");
  i++;
  const patch = { updateFiles: [], addFiles: [], deleteFiles: [] };
  const readPath = (line, prefix) => line.slice(prefix.length).trim();
  let ended = false;
  while (i < lines.length && !END_PATCH.test(lines[i])) {
    const line = lines[i].trim();
    if (line.startsWith("*** Add File: ")) {
      const path = readPath(line, "*** Add File: ");
      i++;
      if (!path) throw new Error("v4a: add file path is empty");
      const body = [];
      while (i < lines.length && !DIRECTIVE.test(lines[i])) {
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
      const follow = i < lines.length ? lines[i].trim() : "";
      if (follow.startsWith("*** Move to: ")) {
        moveTo = readPath(follow, "*** Move to: ");
        i++;
      } else if (follow.startsWith("*** Rename to: ")) {
        moveTo = readPath(follow, "*** Rename to: ");
        i++;
      }
      const hunks = [];
      while (i < lines.length && !DIRECTIVE.test(lines[i])) {
        if (lines[i].trimStart().startsWith("@@")) {
          let ctx = lines[i].trimStart().slice(2).trim();
          if (ctx.startsWith(" ")) ctx = ctx.slice(1);
          i++;
          const hunkLines = [];
          while (i < lines.length && !HUNK_OR_DIRECTIVE.test(lines[i])) {
            const l = lines[i];
            if (l.startsWith("+")) hunkLines.push({ kind: "add", text: l.slice(1) });
            else if (l.startsWith("-")) hunkLines.push({ kind: "remove", text: l.slice(1) });
            else hunkLines.push({ kind: "context", text: l.startsWith(" ") ? l.slice(1) : l });
            i++;
          }
          hunks.push({ changeContext: ctx || void 0, lines: hunkLines });
          if (i < lines.length && END_OF_FILE.test(lines[i])) {
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
  if (i < lines.length && END_PATCH.test(lines[i])) ended = true;
  if (!ended) throw new Error("v4a: missing *** End Patch");
  if (!patch.updateFiles.length && !patch.addFiles.length && !patch.deleteFiles.length) {
    throw new Error("v4a: patch contains no file operations");
  }
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
  const ensureEol = (content, eol) => content.length > 0 && !content.endsWith("\n") ? content + eol : content;
  const setLines = (p, l) => {
    const eol = lineEndings.get(p) ?? "\n";
    out.set(p, ensureEol(l.join(eol), eol));
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
      out.set(add.path, ensureEol(add.lines.join("\n"), "\n"));
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
      const endIndex = cur.length > 0 && cur[cur.length - 1] === "" ? cur.length - 1 : cur.length;
      const base = removePat.length === 0 ? endIndex : anchorIdx;
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
var MutationPolicy = class {
  policy;
  constructor(ctx) {
    this.policy = ctx.fs.sandboxMode === void 0 ? void 0 : ctx.get("sandboxPolicy");
    if (ctx.fs.sandboxMode !== void 0 && this.policy === void 0) {
      throw new Error("codex-edit-fusion: the mounted filesystem confines but ctx.sandboxPolicy is missing");
    }
  }
  resolve(exec) {
    return this.policy?.resolve({
      ...exec.agent === void 0 ? {} : { session: exec.agent.session }
    });
  }
  mapError(error, policy) {
    if (!(error instanceof FsError) || error.code !== "FS_SANDBOX_DENIED") return error;
    const mode = policy.mode;
    return new FsError(sandboxDenialMarker(mode), "FS_SANDBOX_DENIED", { cause: error });
  }
};
function acceptSingleTarget(patch) {
  const count = patch.addFiles.length + patch.updateFiles.length + patch.deleteFiles.length;
  if (count !== 1) {
    throw new Error("codex_apply_patch accepts exactly one Add File or one Update File declaration");
  }
  if (patch.deleteFiles.length !== 0) {
    throw new Error("codex_apply_patch does not support Delete File declarations");
  }
  const add = patch.addFiles[0];
  if (add !== void 0) {
    return { kind: "add", path: add.path, content: add.lines.join("\n") };
  }
  const update = patch.updateFiles[0];
  if (update === void 0) {
    throw new Error("codex_apply_patch requires one Add File or one Update File declaration");
  }
  if (update.moveTo !== void 0) {
    throw new Error("codex_apply_patch does not support Move to or Rename to directives");
  }
  return { kind: "update", path: update.path, patch };
}
async function resolveTarget(ctx, path, exec) {
  if (path.trim().length === 0) throw new Error("patch path must be a non-empty string");
  return ctx.fs.resolve(path, {
    ...exec.agent?.session.header.cwd === void 0 ? {} : { cwd: exec.agent.session.header.cwd },
    signal: exec.signal
  });
}
async function applyAcceptedPatch(ctx, policy, accepted, exec) {
  const sandboxPolicy = policy.resolve(exec);
  const target = await resolveTarget(ctx, accepted.path, exec);
  try {
    if (accepted.kind === "add") {
      await ctx.fs.writeText(
        target,
        accepted.content,
        { kind: "createIfAbsent" },
        exec.signal,
        sandboxPolicy
      );
      return JSON.stringify({ applied: [{ file: accepted.path, status: "applied" }], errors: [] });
    }
    const info = await ctx.fs.stat(target, exec.signal);
    if (info === void 0) {
      throw new FsError(`cannot update "${target.displayPath}": file does not exist`, "FS_NOT_FOUND");
    }
    if (info.type !== "file") {
      throw new FsError(`cannot update "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
    }
    const before = await ctx.fs.readText(target, exec.signal);
    const result = applyPatch(
      accepted.patch,
      /* @__PURE__ */ new Map([[accepted.path, before]]),
      (lines, pattern, start, eof) => seekSequence(lines, pattern, start, eof, "NormalizeToLf")
    );
    if (result.errors.length !== 0) throw new Error(result.errors.join("; "));
    const after = result.files.get(accepted.path);
    if (after === void 0) throw new Error(`patch removed its update target: ${accepted.path}`);
    await ctx.fs.writeText(
      target,
      after,
      { kind: "replaceIfVersion", version: info.version },
      exec.signal,
      sandboxPolicy
    );
    return JSON.stringify({ applied: result.results, errors: [] });
  } catch (error) {
    throw policy.mapError(error, sandboxPolicy);
  }
}
var name = "codex-edit-fusion";
var inject = ["tools", "fs"];
var Config = z.object({});
function apply(ctx, _config) {
  const policy = new MutationPolicy(ctx);
  ctx.tools.register(defineTool({
    name: "codex_apply_patch",
    description: [
      "Apply exactly one openai/codex V4A Add File or Update File patch.",
      "One Update File may contain multiple hunks. Delete, move, rename, and multi-file patches are rejected.",
      "Relative paths resolve from the current session workspace."
    ].join(" "),
    parameters: {
      patch: {
        type: "string",
        required: true,
        description: "Complete V4A text from *** Begin Patch through *** End Patch."
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    async execute(args, exec) {
      const parsed = parsePatch(args.patch);
      const accepted = acceptSingleTarget(parsed);
      return applyAcceptedPatch(ctx, policy, accepted, exec);
    }
  }));
}
export {
  Config,
  apply,
  applyPatch,
  inject,
  name,
  parsePatch,
  seekSequence
};
