// src/decision.ts
var RANK = { Allow: 0, Prompt: 1, Forbidden: 2 };
function maxDecision(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}
function aggregate(decisions) {
  if (decisions.length === 0) return "Prompt";
  return decisions.reduce(maxDecision);
}

// src/rule.ts
function singleToken(value) {
  return { kind: "Single", value };
}
function altsToken(values) {
  return { kind: "Alts", values };
}
function prefixRule(first, rest, decision) {
  return { first, rest: rest.map(singleToken), decision };
}
function tokenMatches(t, arg) {
  switch (t.kind) {
    case "Single":
      return t.value === arg;
    case "Alts":
      return t.values.includes(arg);
  }
}
function ruleMatches(rule, cmd) {
  if (cmd[0] !== rule.first) return false;
  if (cmd.length - 1 < rule.rest.length) return false;
  for (let i = 0; i < rule.rest.length; i++) {
    if (!tokenMatches(rule.rest[i], cmd[i + 1])) return false;
  }
  return true;
}

// src/policy.ts
var Policy = class _Policy {
  rulesByProgram = /* @__PURE__ */ new Map();
  networkAllowed = /* @__PURE__ */ new Set();
  networkDenied = /* @__PURE__ */ new Set();
  addPrefixRule(rule) {
    const list = this.rulesByProgram.get(rule.first) ?? [];
    list.push(rule);
    this.rulesByProgram.set(rule.first, list);
  }
  allowNetwork(host) {
    this.networkAllowed.add(host);
    this.networkDenied.delete(host);
  }
  denyNetwork(host) {
    this.networkDenied.add(host);
    this.networkAllowed.delete(host);
  }
  allowedDomains() {
    return [...this.networkAllowed];
  }
  deniedDomains() {
    return [...this.networkDenied];
  }
  mergeOverlay(overlay) {
    const out = new _Policy();
    for (const [prog, rules] of this.rulesByProgram) out.rulesByProgram.set(prog, [...rules]);
    for (const [prog, rules] of overlay.rulesByProgram) {
      out.rulesByProgram.set(prog, [...out.rulesByProgram.get(prog) ?? [], ...rules]);
    }
    out.networkAllowed = /* @__PURE__ */ new Set([...this.networkAllowed, ...overlay.networkAllowed]);
    out.networkDenied = /* @__PURE__ */ new Set([...this.networkDenied, ...overlay.networkDenied]);
    return out;
  }
  /** Matches rules for cmd; if none match, falls back to the caller heuristic. */
  check(cmd, heuristic = () => "Prompt") {
    const rules = this.rulesByProgram.get(cmd[0]) ?? [];
    const matched = rules.filter((r) => ruleMatches(r, cmd));
    if (matched.length === 0) {
      return { decision: heuristic(cmd), matchedPrograms: [] };
    }
    return {
      decision: aggregate(matched.map((r) => r.decision)),
      matchedPrograms: matched.map((r) => r.first)
    };
  }
};

// src/starlarkLite.ts
var isDecision = (s) => s === "ALLOW" || s === "FORBIDDEN" || s === "PROMPT";
var normDecision = (s) => s === "ALLOW" ? "Allow" : s === "FORBIDDEN" ? "Forbidden" : "Prompt";
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        s += src[i];
        i++;
      }
      i++;
      toks.push(JSON.stringify(s));
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) {
        s += src[i];
        i++;
      }
      toks.push(s);
      continue;
    }
    if ("[],()".includes(c)) {
      toks.push(c);
      i++;
      continue;
    }
    throw new Error("starlark-lite: unexpected char " + JSON.stringify(c));
  }
  return toks;
}
function splitTopLevel(outer) {
  const parts = [];
  let cur = "";
  let depth = 0;
  let inStr = false;
  let q = "";
  for (const ch of outer) {
    if (inStr) {
      cur += ch;
      if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "[" || ch === "(") {
      depth++;
      if (depth === 1) {
        cur = "";
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) {
        parts.push(cur.trim());
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "," && depth === 1) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  return parts;
}
function parseCalls(toks) {
  const calls = [];
  let i = 0;
  while (i < toks.length) {
    if (/^[a-z_]+$/.test(toks[i]) && toks[i + 1] === "(") {
      const fn = toks[i];
      i += 2;
      const args = [];
      let cur = "";
      let depth = 0;
      while (i < toks.length) {
        const t = toks[i];
        if (t === ")" && depth === 0) {
          if (cur) args.push(cur);
          i++;
          break;
        }
        if (t === "," && depth === 0) {
          if (cur) args.push(cur);
          cur = "";
          i++;
          continue;
        }
        if (t === "[" || t === "(") {
          depth++;
          cur += t;
          i++;
          continue;
        }
        if (t === "]" || t === ")") {
          depth--;
          cur += t;
          i++;
          continue;
        }
        cur += t;
        i++;
      }
      calls.push({ fn, args });
    } else i++;
  }
  return calls;
}
function parsePolicyFile(src) {
  const out = { prefixRules: [], networkRules: [] };
  for (const call of parseCalls(tokenize(src))) {
    if (call.fn === "prefix_rule") {
      const [progRaw, listRaw, decRaw] = call.args;
      const program = JSON.parse(progRaw);
      const items = splitTopLevel(listRaw).filter((s) => s.length > 0);
      const tokens = items.map((item) => {
        const v = JSON.parse(item);
        return Array.isArray(v) ? { kind: "Alts", values: v } : { kind: "Single", value: String(v) };
      });
      if (!isDecision(decRaw)) throw new Error("bad decision " + decRaw);
      out.prefixRules.push({ program, args: tokens, decision: normDecision(decRaw) });
    } else if (call.fn === "network_rule" && call.args.length >= 3) {
      const [hostRaw, proto, decRaw] = call.args;
      const host = JSON.parse(hostRaw);
      if (!isDecision(decRaw)) throw new Error("bad decision " + decRaw);
      out.networkRules.push({ host, protocol: proto, decision: normDecision(decRaw) });
    }
  }
  return out;
}

// src/shellParser.ts
function parseShellLine(line) {
  const result = { invocations: [], heredocs: [], substitutions: [], comments: [] };
  if (!line.trim()) return result;
  const argv = [];
  const redirects = [];
  const invocationSubstitutions = [];
  const pushInvocation = () => {
    if (argv.length || redirects.length) {
      result.invocations.push({
        argv: [...argv],
        redirects: [...redirects],
        substitutions: [...invocationSubstitutions]
      });
    }
    argv.length = 0;
    redirects.length = 0;
    invocationSubstitutions.length = 0;
  };
  let i = 0;
  let cur = "";
  let q = null;
  const flushWord = () => {
    if (cur !== "") {
      argv.push(cur);
      cur = "";
    }
  };
  const flushOp = () => {
    flushWord();
    pushInvocation();
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === "#" && q === null && (cur === "" || /\s$/.test(cur))) {
      if (cur.trim()) argv.push(cur.trim());
      result.comments.push(line.slice(i + 1).trim());
      break;
    }
    if (q) {
      if (q === "'" && ch === "'") q = null;
      else if (q === '"' && ch === '"') q = null;
      else if (q === '"' && ch === "\\" && '"\\$`'.includes(line[i + 1] ?? "")) {
        cur += ch;
        i++;
        cur += line[i];
      } else cur += ch;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      cur += line[i + 1];
      i += 2;
      continue;
    }
    if (ch === "$" && line[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let inner = "";
      while (j < line.length && depth > 0) {
        if (line[j] === "(") depth++;
        if (line[j] === ")") {
          depth--;
          if (depth === 0) break;
        }
        inner += line[j];
        j++;
      }
      result.substitutions.push(inner);
      invocationSubstitutions.push(inner);
      argv.push(cur + `$(${inner})`);
      cur = "";
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      if (end === -1) {
        cur += ch;
        i++;
        continue;
      }
      const inner = line.slice(i + 1, end);
      result.substitutions.push(inner);
      invocationSubstitutions.push(inner);
      argv.push(cur + `\`${inner}\``);
      cur = "";
      i = end + 1;
      continue;
    }
    if (ch === "<" && line[i + 1] === "<") {
      let j = i + 2;
      let dash = false;
      if (line[j] === "-") {
        dash = true;
        j++;
      }
      while (j < line.length && line[j] === " ") j++;
      const tagMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(j));
      if (tagMatch) {
        const tag = tagMatch[1];
        const nl = line.indexOf("\n", j);
        if (nl !== -1) {
          const bodyLines = [];
          const rest = line.slice(nl + 1).split("\n");
          while (rest.length) {
            const l = rest.shift();
            const cmp = dash ? l.replace(/^\t+/, "") : l;
            if (cmp === tag) break;
            bodyLines.push(l);
          }
          result.heredocs.push({ tag, body: bodyLines.join("\n") });
          redirects.push(`<<${tag}`);
          argv.push(cur);
          cur = "";
          const consumed = nl + 1 + bodyLines.join("\n").length + (bodyLines.length ? bodyLines.length : 0);
          i = line.length;
          flushOp();
          void consumed;
          continue;
        }
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === ">" || ch === "<") {
      flushWord();
      let op = ch;
      if (line[i + 1] === ch) {
        op += ch;
        i++;
      } else if (ch === ">" && line[i + 1] === "&") {
        op += "&";
        i++;
      }
      i++;
      while (i < line.length && /\s/.test(line[i])) i++;
      let target = "";
      while (i < line.length && !/[\s|&;]/.test(line[i])) {
        target += line[i];
        i++;
      }
      redirects.push(`${op}${target}`);
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&") {
      flushOp();
      const two = line.slice(i, i + 2);
      if (two === "&&" || two === "||") i++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  flushOp();
  return result;
}
function shellSubCommands(line) {
  const parsed = parseShellLine(line);
  const cmds = parsed.invocations.map((inv) => inv.argv.join(" "));
  cmds.push(...parsed.substitutions);
  for (const h of parsed.heredocs) cmds.push(h.body);
  return cmds.filter((c) => c.trim() !== "");
}

// src/parseCommand/shlex.ts
var NUL = 0;
function isShlexWhitespace(c) {
  return c === " " || c === "	" || c === "\n";
}
function shlexSplit(inStr) {
  if (inStr.includes(String.fromCharCode(NUL))) return null;
  const out = [];
  let i = 0;
  const n = inStr.length;
  let hadError = false;
  const nextChar = () => i < n ? inStr[i++] : null;
  function parseDouble(result) {
    for (; ; ) {
      const ch2 = nextChar();
      if (ch2 === null) return false;
      if (ch2 === "\\") {
        const ch3 = nextChar();
        if (ch3 === null) return false;
        if (ch3 === "$" || ch3 === "`" || ch3 === '"' || ch3 === "\\") {
          result.s += ch3;
        } else if (ch3 === "\n") {
        } else {
          result.s += "\\" + ch3;
        }
      } else if (ch2 === '"') {
        return true;
      } else {
        result.s += ch2;
      }
    }
  }
  function parseSingle(result) {
    for (; ; ) {
      const ch2 = nextChar();
      if (ch2 === null) return false;
      if (ch2 === "'") return true;
      result.s += ch2;
    }
  }
  function parseWord(first) {
    const result = { s: "" };
    let ch = first;
    for (; ; ) {
      if (ch === '"') {
        if (!parseDouble(result)) {
          hadError = true;
          return result.s;
        }
      } else if (ch === "'") {
        if (!parseSingle(result)) {
          hadError = true;
          return result.s;
        }
      } else if (ch === "\\") {
        const ch2 = nextChar();
        if (ch2 === null) {
          hadError = true;
          return result.s;
        }
        if (ch2 !== "\n") result.s += ch2;
      } else if (isShlexWhitespace(ch)) {
        break;
      } else {
        result.s += ch;
      }
      ch = nextChar();
      if (ch === null) break;
    }
    return result.s;
  }
  for (; ; ) {
    let ch = nextChar();
    if (ch === null) break;
    for (; ; ) {
      if (ch === " " || ch === "	" || ch === "\n") {
        ch = nextChar();
        if (ch === null) return hadError ? null : out;
        continue;
      }
      if (ch === "#") {
        let c2 = nextChar();
        while (c2 !== null && c2 !== "\n") c2 = nextChar();
        ch = c2;
        if (ch === null) return hadError ? null : out;
        continue;
      }
      break;
    }
    const word = parseWord(ch);
    if (hadError) return null;
    out.push(word);
  }
  return hadError ? null : out;
}
function unquotedOk(c) {
  if (c.charCodeAt(0) >= 128) return false;
  return /^[+\-./:@\]_0-9A-Za-z]$/.test(c);
}
function singleQuotedOk(c) {
  return c !== "'" && c !== "^" && c !== "\\";
}
function doubleQuotedOk(c) {
  return c !== "$" && c !== "`" && c !== "!" && c !== "^";
}
var UNQUOTED = 1;
var SINGLE = 2;
var DOUBLE = 4;
function quotingStrategy(bytes) {
  const prevAll = UNQUOTED | SINGLE | DOUBLE;
  let prevOk = prevAll;
  let i = 0;
  if (bytes[0] === "^") {
    prevOk = SINGLE;
    i = 1;
  }
  while (i < bytes.length) {
    const c = bytes[i];
    let curOk = prevOk;
    if (c.charCodeAt(0) >= 128) {
      curOk &= ~UNQUOTED;
    } else {
      if (!unquotedOk(c)) curOk &= ~UNQUOTED;
      if (!singleQuotedOk(c)) curOk &= ~SINGLE;
      if (!doubleQuotedOk(c)) curOk &= ~DOUBLE;
    }
    if (curOk === 0) break;
    prevOk = curOk;
    i += 1;
  }
  const strategy = prevOk & UNQUOTED ? UNQUOTED : prevOk & SINGLE ? SINGLE : DOUBLE;
  return { len: Math.max(i, 1), strategy };
}
function appendQuotedChunk(out, chunk, strategy) {
  if (strategy === UNQUOTED) return out + chunk.join("");
  if (strategy === SINGLE) return out + "'" + chunk.join("") + "'";
  let s = out + '"';
  for (const c of chunk) {
    if (c === "$" || c === "`" || c === '"' || c === "\\") s += "\\";
    s += c;
  }
  return s + '"';
}
function shlexQuote(inStr) {
  if (inStr === "") return "''";
  if (inStr.includes(String.fromCharCode(NUL))) {
    throw new Error("cannot shell-quote string containing nul byte");
  }
  const bytes = [...inStr];
  let out = "";
  let rest = bytes;
  while (rest.length > 0) {
    const { len, strategy } = quotingStrategy(rest);
    const chunk = rest.slice(0, len);
    if (len === rest.length && strategy === UNQUOTED && out === "") {
      return inStr;
    }
    out = appendQuotedChunk(out, chunk, strategy);
    rest = rest.slice(len);
  }
  return out;
}
function shlexTryJoin(tokens) {
  for (const t of tokens) {
    if (t.includes(String.fromCharCode(NUL))) return null;
  }
  return tokens.map(shlexQuote).join(" ");
}
function shlexJoin(tokens) {
  return shlexTryJoin(tokens) ?? "<command included NUL byte>";
}

// src/commandSafety.ts
var MAX_WRAPPER_DEPTH = 8;
var WINDOWS_EXEC_SUFFIXES = [".exe", ".cmd", ".bat", ".com"];
var DELETE_CMDLETS = ["remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"];
var SEG_SEPS = [";", "|", "&", "\n", "\r", "	"];
var SOFT_SEPS = ["{", "}", "(", ")", "[", "]", ",", ";"];
function splitInvocationSegments(line) {
  const segments = [];
  let cur = "";
  let q = null;
  const flush = () => {
    const words = shlexSplit(cur.trim());
    if (words && words.length) segments.push(words);
    cur = "";
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === ";" || ch === "\n") {
      flush();
      continue;
    }
    if (ch === "|") {
      flush();
      if (line[i + 1] === "|") i++;
      continue;
    }
    if (ch === "&") {
      flush();
      if (line[i + 1] === "&") i++;
      continue;
    }
    cur += ch;
  }
  flush();
  return segments;
}
function executableBasename(exe) {
  const name2 = exe.split(/[\\/]/).pop() ?? "";
  if (!name2) return null;
  let stripped = name2;
  const m = /^([A-Za-z]):(.*)$/.exec(stripped);
  if (m) stripped = m[2];
  return stripped ? stripped.toLowerCase() : null;
}
function executableNameLookupKey(raw, platform) {
  if (platform === "posix") {
    const name3 = raw.split("/").pop() ?? "";
    return name3 || null;
  }
  let name2 = raw.split(/[\\/]/).pop() ?? "";
  if (!name2) return null;
  const drive = /^([A-Za-z]):(.*)$/.exec(name2);
  if (drive) name2 = drive[2];
  name2 = name2.toLowerCase();
  for (const suffix of WINDOWS_EXEC_SUFFIXES) {
    if (name2.endsWith(suffix)) return name2.slice(0, -suffix.length);
  }
  return name2 || null;
}
function isPowershellExecutable(exe) {
  const base = executableBasename(exe);
  return base === "powershell" || base === "powershell.exe" || base === "pwsh" || base === "pwsh.exe";
}
function isBrowserExecutable(name2) {
  return ["chrome", "chrome.exe", "msedge", "msedge.exe", "firefox", "firefox.exe", "iexplore", "iexplore.exe"].includes(name2);
}
function looksLikeUrl(token) {
  const lower = token.toLowerCase();
  const httpsAt = lower.indexOf("https://");
  const httpAt = lower.indexOf("http://");
  const idx = httpsAt !== -1 && (httpAt === -1 || httpsAt < httpAt) ? httpsAt : httpAt;
  const urlish = idx !== -1 ? token.slice(idx) : token;
  const m = /^[ "'(]*([^\s"');]+)[\s;)]*$/.exec(urlish);
  if (!m) return false;
  try {
    const u = new URL(m[1]);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function argsHaveUrl(args) {
  return args.some((a) => looksLikeUrl(a));
}
function rmArgsIncludeForceOption(args) {
  return args.slice(0, args.indexOf("--") === -1 ? args.length : args.indexOf("--")).some((arg) => arg === "--force" || /^-[^-]/.test(arg) && arg.slice(1).includes("f"));
}
function shLiteralCommands(script) {
  return splitInvocationSegments(script);
}
function dangerousCommandMatch(command, options = {}) {
  const platform = options.platform ?? (process.platform === "win32" ? "windows" : "posix");
  return matchWithDepth(command, options.wrapperDepth ?? 0, platform);
}
function dangerousCommandMatchLine(line, options = {}) {
  const platform = options.platform ?? (process.platform === "win32" ? "windows" : "posix");
  for (const sub of shellSubCommands(line)) {
    const words = shlexSplit(sub);
    if (!words?.length) continue;
    const m = matchWithDepth(words, options.wrapperDepth ?? 0, platform);
    if (m) return m;
  }
  return null;
}
function matchWithDepth(command, wrapperDepth, platform) {
  if (wrapperDepth > MAX_WRAPPER_DEPTH) return "Other";
  const execMatch = matchForExec(command, wrapperDepth, platform);
  if (execMatch) return execMatch;
  if (command.length >= 3 && executableNameLookupKey(command[0], "posix") && ["sh", "bash", "dash", "zsh", "ksh"].includes(executableNameLookupKey(command[0], "posix"))) {
    const flagIdx = command.findIndex((t, i) => i > 0 && (t === "-c" || t === "-lc" || t === "--command"));
    if (flagIdx > 0 && typeof command[flagIdx + 1] === "string") {
      const nested = shLiteralCommands(command[flagIdx + 1]);
      if (nested) {
        for (const invocation of nested) {
          const m = matchWithDepth(invocation, wrapperDepth + 1, platform);
          if (m) return m;
        }
      }
    }
  }
  if (platform === "windows" && isDangerousCommandWindows(command)) return "Other";
  return null;
}
function matchForExec(command, wrapperDepth, platform) {
  const esc = detectEscalation(command, platform);
  if (esc) return matchWithDepth(esc.rest, wrapperDepth + 1, platform);
  const key = command.length ? executableNameLookupKey(command[0], platform) : null;
  if (key === "rm" && rmArgsIncludeForceOption(command.slice(1))) return "ForcedRm";
  if (key === "env") return matchForEnv(command, wrapperDepth, platform);
  if (key === "trap") return matchForTrap(command, wrapperDepth, platform);
  return null;
}
function skipLeadingOptions(args, platform) {
  const isOpt = (t) => platform === "windows" ? /^[-/]/.test(t) : t.startsWith("-");
  let i = 0;
  while (i < args.length && isOpt(args[i])) {
    i++;
    if (platform !== "windows" && /^-[a-zA-Z]$/.test(args[i - 1] ?? "")) {
      if (i < args.length) i++;
    }
  }
  return args.slice(i);
}
function detectEscalation(command, platform) {
  if (!command.length) return null;
  const key = executableNameLookupKey(command[0], platform);
  if (!key) return null;
  if (key === "sudo" || key === "doas" || key === "pkexec" || key === "gsudo" || key === "elevate") {
    return { escalator: key, rest: skipLeadingOptions(command.slice(1), "posix") };
  }
  if (key === "runas") {
    return { escalator: "runas", rest: skipLeadingOptions(command.slice(1), "windows") };
  }
  if (key === "su") {
    const cIdx = command.findIndex((t, i) => i > 0 && (t === "-c" || t === "--command"));
    if (cIdx > 0 && typeof command[cIdx + 1] === "string") {
      return { escalator: "su", rest: ["sh", "-c", command[cIdx + 1]] };
    }
  }
  return null;
}
function matchForEnv(command, wrapperDepth, platform) {
  let i = 1;
  while (i < command.length) {
    const arg = command[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "-i" || arg === "--ignore-environment" || /^[^-]+=/.test(arg)) {
      i++;
      continue;
    }
    break;
  }
  return matchWithDepth(command.slice(i), wrapperDepth + 1, platform);
}
function matchForTrap(command, wrapperDepth, platform) {
  let actionIndex = 1;
  if (command[actionIndex] === "--") actionIndex++;
  const action = command[actionIndex];
  if (action === void 0 || action.startsWith("-")) return null;
  return matchWithDepth(["sh", "-c", action], wrapperDepth + 1, platform);
}
function isDangerousCommandWindows(command) {
  if (isDangerousPowershell(command)) return true;
  if (isDangerousCmd(command)) return true;
  return isDirectGuiLaunch(command);
}
function isPowershellInvocationArgs(args) {
  if (!args.length) return null;
  let idx = 0;
  while (idx < args.length) {
    const arg = args[idx];
    const lower = arg.toLowerCase();
    if (lower === "-command" || lower === "/command" || lower === "-c") {
      const script = args[idx + 1];
      if (script === void 0) return null;
      if (idx + 2 !== args.length) return null;
      return shlexSplit(script);
    }
    if (lower.startsWith("-command:") || lower.startsWith("/command:")) {
      if (idx + 1 !== args.length) return null;
      return shlexSplit(arg.slice(arg.indexOf(":") + 1));
    }
    if (["-nologo", "-noprofile", "-noninteractive", "-mta", "-sta"].includes(lower) || lower.startsWith("-")) {
      idx++;
      continue;
    }
    return args.slice(idx);
  }
  return null;
}
function isDangerousPowershell(command) {
  if (!command.length) return false;
  if (!isPowershellExecutable(command[0])) return false;
  const tokens = isPowershellInvocationArgs(command.slice(1));
  if (!tokens) return false;
  return isDangerousPowershellWords(tokens);
}
function isDangerousPowershellWords(words) {
  const tokensLc = words.map((t) => t.replace(/^'+|^"+/g, "").replace(/'+$|"+$/g, "").toLowerCase());
  const hasUrl = argsHaveUrl(words);
  if (hasUrl && tokensLc.some((t) => ["start-process", "start", "saps", "invoke-item", "ii"].includes(t) || t.includes("start-process") || t.includes("invoke-item"))) return true;
  if (hasUrl && tokensLc.some((t) => t.includes("shellexecute") || t.includes("shell.application"))) return true;
  const first = tokensLc[0];
  if (first) {
    if (first === "rundll32" && tokensLc.some((t) => t.includes("url.dll,fileprotocolhandler")) && hasUrl) return true;
    if (first === "mshta" && hasUrl) return true;
    if (isBrowserExecutable(first) && hasUrl) return true;
    if (first === "explorer" || first === "explorer.exe") {
      if (hasUrl) return true;
    }
  }
  return hasForceDeleteCmdlet(tokensLc);
}
function isDangerousCmd(command) {
  if (!command.length) return false;
  const base = executableBasename(command[0]);
  if (base !== "cmd" && base !== "cmd.exe") return false;
  let i = 1;
  for (; i < command.length; i++) {
    const lower = command[i].toLowerCase();
    if (lower === "/c" || lower === "/r" || lower === "-c") {
      i++;
      break;
    }
    if (lower.startsWith("/")) continue;
    return false;
  }
  const remaining = command.slice(i);
  if (!remaining.length) return false;
  const cmdTokens = remaining.length === 1 ? shlexSplit(remaining[0]) ?? [remaining[0]] : remaining;
  const tokens = cmdTokens.flatMap(splitEmbeddedCmdOperators);
  const CMD_SEPARATORS = ["&", "&&", "|", "||"];
  const segments = [[]];
  for (const t of tokens) {
    if (CMD_SEPARATORS.includes(t)) segments.push([]);
    else segments[segments.length - 1].push(t);
  }
  return segments.some((segment) => {
    const cmd = segment[0];
    if (cmd === void 0) return false;
    if (cmd.toLowerCase() === "start" && argsHaveUrl(segment)) return true;
    if ((cmd.toLowerCase() === "del" || cmd.toLowerCase() === "erase") && hasForceFlagCmd(segment)) return true;
    if ((cmd.toLowerCase() === "rd" || cmd.toLowerCase() === "rmdir") && hasRecursiveFlagCmd(segment) && hasQuietFlagCmd(segment)) return true;
    return false;
  });
}
function isDirectGuiLaunch(command) {
  if (!command.length) return false;
  const base = executableBasename(command[0]);
  if (!base) return false;
  const rest = command.slice(1);
  if ((base === "explorer" || base === "explorer.exe") && argsHaveUrl(rest)) return true;
  if ((base === "mshta" || base === "mshta.exe") && argsHaveUrl(rest)) return true;
  if ((base === "rundll32" || base === "rundll32.exe") && rest.some((t) => t.toLowerCase().includes("url.dll,fileprotocolhandler")) && argsHaveUrl(rest)) return true;
  if (isBrowserExecutable(base) && argsHaveUrl(rest)) return true;
  return false;
}
function splitEmbeddedCmdOperators(token) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "&" || ch === "|") {
      if (i > start) parts.push(token.slice(start, i));
      const opLen = token[i + 1] === ch ? 2 : 1;
      parts.push(token.slice(i, i + opLen));
      i += opLen - 1;
      start = i + 1;
    }
  }
  if (start < token.length) parts.push(token.slice(start));
  return parts.filter((s) => s.trim() !== "");
}
function hasForceDeleteCmdlet(tokens) {
  const segments = [[]];
  for (const tok of tokens) {
    let cur = "";
    for (const ch of tok) {
      if (SEG_SEPS.includes(ch)) {
        const s2 = cur.trim();
        const last = segments[segments.length - 1];
        if (s2) last.push(s2);
        cur = "";
        if (segments[segments.length - 1].length) segments.push([]);
      } else cur += ch;
    }
    const s = cur.trim();
    if (s) segments[segments.length - 1].push(s);
  }
  return segments.some((seg) => {
    const atoms = seg.flatMap((t) => t.split(new RegExp(`[${SOFT_SEPS.map(escapeRe).join("")}]`))).map((s) => s.trim()).filter(Boolean);
    let hasDelete = false;
    let hasForce = false;
    for (const a of atoms) {
      if (DELETE_CMDLETS.includes(a.toLowerCase())) hasDelete = true;
      if (a.toLowerCase() === "-force" || a.toLowerCase().startsWith("-force:")) hasForce = true;
    }
    return hasDelete && hasForce;
  });
}
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hasForceFlagCmd(args) {
  return args.some((a) => a.toLowerCase() === "/f");
}
function hasRecursiveFlagCmd(args) {
  return args.some((a) => a.toLowerCase() === "/s");
}
function hasQuietFlagCmd(args) {
  return args.some((a) => a.toLowerCase() === "/q");
}

// src/outputTruncation.ts
var APPROX_BYTES_PER_TOKEN = 4;
function approxTokenCount(text) {
  const len = Buffer.byteLength(text, "utf8");
  return Math.floor((len + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN);
}
function approxBytesForTokens(tokens) {
  return tokens * APPROX_BYTES_PER_TOKEN;
}
function approxTokensFromByteCount(bytes) {
  if (bytes <= 0) return 0;
  return Math.floor((bytes + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN);
}
function truncateMiddleChars(s, maxBytes) {
  return truncateWithByteEstimate(s, maxBytes, false);
}
function truncateMiddleWithTokenBudget(s, maxTokens) {
  if (!s) return ["", null];
  if (maxTokens > 0 && Buffer.byteLength(s, "utf8") <= approxBytesForTokens(maxTokens)) return [s, null];
  const truncated = truncateWithByteEstimate(s, approxBytesForTokens(maxTokens), true);
  const totalTokens = approxTokenCount(s);
  return truncated === s ? [truncated, null] : [truncated, totalTokens];
}
function truncateWithByteEstimate(s, maxBytes, useTokens) {
  if (!s) return "";
  if (maxBytes === 0) return formatMarker(useTokens, removedUnits(useTokens, Buffer.byteLength(s, "utf8"), [...s].length));
  const totalBytes = Buffer.byteLength(s, "utf8");
  if (totalBytes <= maxBytes) return s;
  const leftBudget = Math.floor(maxBytes / 2);
  const rightBudget = maxBytes - leftBudget;
  const chars = [...s];
  const removedCharsSet = /* @__PURE__ */ new Set();
  let byteCursor = 0;
  let prefixEndIdx = 0;
  let suffixStartIdx = 0;
  const charStarts = [];
  for (let i = 0; i < chars.length; i++) {
    charStarts.push(byteCursor);
    byteCursor += Buffer.byteLength(chars[i], "utf8");
  }
  const totalEnd = byteCursor;
  const tailStartTarget = Math.max(0, totalBytes - rightBudget);
  for (let i = 0; i < chars.length; i++) {
    const charEnd = charStarts[i] + Buffer.byteLength(chars[i], "utf8");
    if (charEnd <= leftBudget) {
      prefixEndIdx = i + 1;
      continue;
    }
    if (charStarts[i] >= tailStartTarget) {
      suffixStartIdx = i;
      break;
    }
    removedCharsSet.add(i);
  }
  if (suffixStartIdx < prefixEndIdx) suffixStartIdx = prefixEndIdx;
  const removedChars = removedCharsSet.size;
  const removedBytes = Math.max(0, totalEnd - maxBytes);
  const marker = formatMarker(useTokens, removedUnits(useTokens, removedBytes, removedChars));
  return chars.slice(0, prefixEndIdx).join("") + marker + chars.slice(suffixStartIdx).join("");
}
function formatMarker(useTokens, removedCount) {
  return useTokens ? `\u2026${removedCount} tokens truncated\u2026` : `\u2026${removedCount} chars truncated\u2026`;
}
function removedUnits(useTokens, removedBytes, removedChars) {
  return useTokens ? approxTokensFromByteCount(removedBytes) : removedChars;
}
function formattedTruncateText(content, policy) {
  const budgetBytes = policy.kind === "bytes" ? policy.budget : approxBytesForTokens(policy.budget);
  if (Buffer.byteLength(content, "utf8") <= budgetBytes) return content;
  const originalTokenCount = approxTokenCount(content);
  const totalLines = content.split("\n").length;
  const result = truncateText(content, policy);
  return `Warning: truncated output (original token count: ${originalTokenCount})
Total output lines: ${totalLines}

${result}`;
}
function truncateText(content, policy) {
  return policy.kind === "bytes" ? truncateMiddleChars(content, policy.budget) : truncateMiddleWithTokenBudget(content, policy.budget)[0];
}
function truncateFunctionOutputItems(items, policy, estimateAudioTokenCount = () => 0) {
  const out = [];
  let remainingBudget = policy.budget;
  let omittedTextItems = 0;
  let omittedAudioItems = 0;
  for (const item of items) {
    if (item.type === "input_text") {
      if (item.text === "") continue;
      if (remainingBudget === 0) {
        omittedTextItems++;
        continue;
      }
      const cost = policy.kind === "bytes" ? Buffer.byteLength(item.text, "utf8") : approxTokenCount(item.text);
      if (cost <= remainingBudget) {
        out.push(item);
        remainingBudget -= cost;
      } else {
        const snippet = truncateText(item.text, { kind: policy.kind, budget: remainingBudget });
        if (snippet === "") omittedTextItems++;
        else out.push({ type: "input_text", text: snippet });
        remainingBudget = 0;
      }
      continue;
    }
    if (item.type === "input_image") {
      out.push(item);
      continue;
    }
    if (item.type === "input_audio") {
      const tokenCost = estimateAudioTokenCount(item.audioUrl);
      const cost = policy.kind === "bytes" ? approxBytesForTokens(tokenCost) : tokenCost;
      if (cost <= remainingBudget) {
        out.push(item);
        remainingBudget -= cost;
      } else omittedAudioItems++;
      continue;
    }
    out.push(item);
  }
  if (omittedTextItems > 0) out.push({ type: "input_text", text: `[omitted ${omittedTextItems} text items ...]` });
  if (omittedAudioItems > 0) out.push({ type: "input_text", text: `[omitted ${omittedAudioItems} audio items ...]` });
  return out;
}

// src/parseCommand/bashWordSeq.ts
var WORD_REJECT_CHARS = /* @__PURE__ */ new Set([
  "{",
  "}",
  "*",
  "?",
  "[",
  "]",
  "\\",
  "~",
  "^",
  "#",
  "$",
  "`"
]);
function isWhitespace(c) {
  return c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
}
function isWordChar(c) {
  if (isWhitespace(c)) return false;
  return !"&|;()<>$`{}`\\#\"'".includes(c);
}
function isPieceLiteralStart(p) {
  return !(p.kind === "word" && p.text.startsWith("="));
}
function pieceHasRejectChar(p) {
  if (p.kind !== "word" && p.kind !== "number") return false;
  for (const c of p.text) {
    if (WORD_REJECT_CHARS.has(c)) return true;
  }
  return false;
}
function parseShellScriptIntoCommands(script) {
  const commands = [];
  let pieces = [];
  let args = [];
  let sawAnyCommand = false;
  let atCommandStart = true;
  let argStartedQuoted = false;
  let awaitingCommand = true;
  let awaitingSeqOp = false;
  const flushArg = () => {
    if (pieces.length === 0) return true;
    if (args.length === 0 && argStartedQuoted) return false;
    for (const p of pieces) {
      if (pieceHasRejectChar(p)) return false;
      if (!isPieceLiteralStart(p)) return false;
    }
    if (atCommandStart && args.length === 0 && pieces[0].kind === "word" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(pieces[0].text)) {
      return false;
    }
    const wasFirst = args.length === 0;
    args.push(pieces.map((p) => p.text).join(""));
    pieces = [];
    argStartedQuoted = false;
    atCommandStart = false;
    if (wasFirst) {
      awaitingCommand = false;
      sawAnyCommand = true;
    }
    return true;
  };
  const flushCommand = () => {
    if (!flushArg()) return false;
    if (args.length > 0) {
      commands.push(args);
      args = [];
    }
    atCommandStart = true;
    return true;
  };
  const onSeqOp = () => {
    if (awaitingCommand || !sawAnyCommand) return false;
    if (!flushCommand()) return false;
    awaitingCommand = true;
    awaitingSeqOp = true;
    return true;
  };
  const iLen = script.length;
  let i = 0;
  while (i < iLen) {
    const c = script[i];
    if (isWhitespace(c)) {
      if (!flushArg()) return null;
      if (c === "\n") {
        if (!flushCommand()) return null;
        awaitingCommand = true;
      }
      i++;
      continue;
    }
    if (c === "&" && script[i + 1] === "&") {
      if (!onSeqOp()) return null;
      i += 2;
      continue;
    }
    if (c === "|" && script[i + 1] === "|") {
      if (!onSeqOp()) return null;
      i += 2;
      continue;
    }
    if (c === "|") {
      if (!onSeqOp()) return null;
      i++;
      continue;
    }
    if (c === ";") {
      if (script[i + 1] === ";") return null;
      if (!flushCommand()) return null;
      awaitingCommand = true;
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === "<" || c === ">" || c === "$" || c === "`" || c === "#" || c === "\\" || c === "{" || c === "}" || c === "&") {
      return null;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const startKind = quote === '"' ? "string" : "raw";
      if (pieces.length === 0) argStartedQuoted = args.length === 0;
      i++;
      let content = "";
      let closed = false;
      while (i < iLen) {
        const q = script[i];
        if (q === quote) {
          closed = true;
          i++;
          break;
        }
        if (quote === '"') {
          if (q === "\\") {
            const nxt = script[i + 1];
            if (nxt === "$" || nxt === "`" || nxt === '"' || nxt === "\\" || nxt === "\n" || nxt === void 0) {
              return null;
            }
            content += q + nxt;
            i += 2;
            continue;
          }
          if (q === "$" || q === "`") return null;
        }
        content += q;
        i++;
      }
      if (!closed) return null;
      pieces.push({ kind: startKind, text: content });
      continue;
    }
    let text = "";
    while (i < iLen) {
      const w = script[i];
      if (!isWordChar(w) || w === '"' || w === "'") break;
      if (WORD_REJECT_CHARS.has(w)) return null;
      if (w === "=" && text === "" && pieces.length === 0) return null;
      text += w;
      i++;
    }
    if (text === "") return null;
    pieces.push({ kind: "word", text });
  }
  if (!flushCommand()) return null;
  if (awaitingCommand && awaitingSeqOp) return null;
  if (!sawAnyCommand) {
    return commands;
  }
  return commands;
}

// src/parseCommand/shellDetect.ts
function fileStem(path) {
  const base = path.split(/[\\/]/).pop() ?? "";
  if (base === "") return null;
  const dot = base.lastIndexOf(".");
  if (dot > 0) return base.slice(0, dot);
  return base;
}
function detectShellType(shellPath) {
  if (shellPath === "zsh") return "zsh";
  if (shellPath === "sh") return "sh";
  if (shellPath === "cmd") return "cmd";
  if (shellPath === "bash") return "bash";
  if (shellPath === "pwsh") return "powershell";
  if (shellPath === "powershell") return "powershell";
  const stem = fileStem(shellPath);
  if (stem !== null && stem !== shellPath) return detectShellType(stem);
  return null;
}
function classifyShell(shellPath) {
  const t = detectShellType(shellPath);
  return t === null || t === "cmd" ? null : t;
}

// src/parseCommand/powershellExtract.ts
var POWERSHELL_FLAGS = ["-nologo", "-noprofile", "-command", "-c"];
function extractPowershellCommand(command) {
  if (command.length < 3) return null;
  const shell = command[0];
  if (detectShellType(shell) !== "powershell") return null;
  let i = 1;
  while (i + 1 < command.length) {
    const flag = command[i];
    if (!POWERSHELL_FLAGS.includes(flag.toLowerCase())) return null;
    if (flag.toLowerCase() === "-command" || flag.toLowerCase() === "-c") {
      const script = command[i + 1];
      return [shell, script];
    }
    i += 1;
  }
  return null;
}

// src/parseCommand/parseCommand.ts
function parsedEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function shlexSplitSafe(s) {
  return shlexSplit(s) ?? s.split(/[ \t\n]+/).filter((t) => t !== "");
}
function tokenizePowershellCommand(command) {
  const normalized = command.replace(/\\/g, "/");
  const tokens = shlexSplit(normalized) ?? normalized.split(/[ \t\n]+/).filter((t) => t !== "");
  const first = tokens[0];
  if (first !== void 0 && ["get-content", "gc", "type"].includes(first.toLowerCase())) {
    tokens[0] = "Get-Content";
    if (tokens.slice(1).some((argument) => !normalized.includes(argument))) {
      return [];
    }
  }
  return tokens;
}
function extractShellCommand(command) {
  return extractBashCommand(command) ?? extractPowershellCommand(command);
}
function extractBashCommand(command) {
  if (command.length !== 3) return null;
  const [shell, flag, script] = command;
  if (flag !== "-lc" && flag !== "-c") return null;
  const kind = classifyShell(shell);
  if (kind !== "zsh" && kind !== "bash" && kind !== "sh") return null;
  return [shell, script];
}
function parseShellLcPlainCommands(command) {
  const extracted = extractBashCommand(command);
  if (extracted === null) return null;
  return parseShellScriptIntoCommands(extracted[1]);
}
function parseCommand(command) {
  const parsed = parseCommandImpl(command);
  const deduped = [];
  for (const cmd of parsed) {
    const prev = deduped[deduped.length - 1];
    if (prev !== void 0 && parsedEq(prev, cmd)) continue;
    deduped.push(cmd);
  }
  if (deduped.some((cmd) => cmd.type === "unknown")) {
    return [singleUnknownForCommand(command)];
  }
  return deduped;
}
function singleUnknownForCommand(command) {
  const extracted = extractShellCommand(command);
  if (extracted !== null) {
    return { type: "unknown", cmd: extracted[1] };
  }
  return { type: "unknown", cmd: shlexJoin(command) };
}
function simplifyOnce(commands) {
  if (commands.length <= 1) return null;
  if (commands[0].type === "unknown") {
    const t = shlexSplit(commands[0].cmd);
    if (t !== null && t[0] === "echo") return commands.slice(1);
  }
  const cdIdx = commands.findIndex((pc) => {
    if (pc.type !== "unknown") return false;
    const t = shlexSplit(pc.cmd);
    return t !== null && t[0] === "cd";
  });
  if (cdIdx !== -1 && commands.length > cdIdx + 1) {
    return [...commands.slice(0, cdIdx), ...commands.slice(cdIdx + 1)];
  }
  const trueIdx = commands.findIndex(
    (pc) => pc.type === "unknown" && pc.cmd === "true"
  );
  if (trueIdx !== -1) {
    return [...commands.slice(0, trueIdx), ...commands.slice(trueIdx + 1)];
  }
  const nlIdx = commands.findIndex((pc) => {
    if (pc.type !== "unknown") return false;
    const t = shlexSplit(pc.cmd);
    return t !== null && t[0] === "nl" && t.slice(1).every((x) => x.startsWith("-"));
  });
  if (nlIdx !== -1) {
    return [...commands.slice(0, nlIdx), ...commands.slice(nlIdx + 1)];
  }
  return null;
}
function isValidSedNArg(arg) {
  if (arg === null) return false;
  if (!arg.endsWith("p")) return false;
  const core = arg.slice(0, -1);
  const parts = core.split(",");
  if (parts.length === 1) {
    const num = parts[0];
    return num !== "" && /^[0-9]+$/.test(num);
  }
  if (parts.length === 2) {
    const [a, b] = parts;
    return a !== "" && b !== "" && /^[0-9]+$/.test(a) && /^[0-9]+$/.test(b);
  }
  return false;
}
function sedHasInPlaceFlag(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") break;
    if (token === "-e" || token === "-f" || token === "--expression" || token === "--file") {
      i++;
      continue;
    }
    if (token === "--in-place") return true;
    if (token.startsWith("--in-place=")) return true;
    if (token.startsWith("--")) continue;
    if (token.startsWith("-")) {
      const shortOptions = token.slice(1);
      for (let index = 0; index < shortOptions.length; index++) {
        const option = shortOptions[index];
        if (option === "i") return true;
        if (option === "e" || option === "f") {
          if (index + option.length === shortOptions.length) i++;
          break;
        }
      }
    }
  }
  return false;
}
function sedReadPath(args) {
  const argsNoConnector = trimAtConnector(args);
  if (sedHasInPlaceFlag(argsNoConnector) || !argsNoConnector.some((arg) => arg === "-n")) {
    return null;
  }
  let hasRangeScript = false;
  let i = 0;
  while (i < argsNoConnector.length) {
    const arg = argsNoConnector[i];
    if (arg === "-e" || arg === "--expression") {
      if (isValidSedNArg(argsNoConnector[i + 1] ?? null)) hasRangeScript = true;
      i += 2;
      continue;
    }
    if (arg === "-f" || arg === "--file") {
      i += 2;
      continue;
    }
    i += 1;
  }
  if (!hasRangeScript) {
    hasRangeScript = argsNoConnector.some(
      (arg) => !arg.startsWith("-") && isValidSedNArg(arg)
    );
  }
  if (!hasRangeScript) return null;
  const candidates = skipFlagValues(argsNoConnector, [
    "-e",
    "-f",
    "--expression",
    "--file"
  ]);
  const nonFlags = candidates.filter((arg) => !arg.startsWith("-"));
  if (nonFlags.length === 0) return null;
  const [first, ...rest] = nonFlags;
  if (isValidSedNArg(first)) return rest[0] ?? null;
  return first;
}
function normalizeTokens(cmd) {
  if (cmd.length >= 3 && (cmd[0] === "yes" || cmd[0] === "y") && cmd[1] === "|") {
    return cmd.slice(2);
  }
  if (cmd.length >= 3 && (cmd[0] === "no" || cmd[0] === "n") && cmd[1] === "|") {
    return cmd.slice(2);
  }
  if (cmd.length === 3 && (cmd[0] === "bash" || cmd[0] === "zsh") && (cmd[1] === "-c" || cmd[1] === "-lc")) {
    return shlexSplit(cmd[2]) ?? [cmd[0], cmd[1], cmd[2]];
  }
  return [...cmd];
}
function containsConnectors(tokens) {
  return tokens.some((t) => t === "&&" || t === "||" || t === "|" || t === ";");
}
function splitOnConnectors(tokens) {
  const out = [];
  let cur = [];
  for (const t of tokens) {
    if (t === "&&" || t === "||" || t === "|" || t === ";") {
      if (cur.length > 0) {
        out.push(cur);
        cur = [];
      }
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
function trimAtConnector(tokens) {
  const idx = tokens.findIndex((t) => t === "|" || t === "&&" || t === "||" || t === ";");
  return idx === -1 ? tokens.slice() : tokens.slice(0, idx);
}
function shortDisplayPath(path) {
  const normalized = path.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  const parts = trimmed.split("/").reverse().filter((p) => {
    return p !== "" && p !== "build" && p !== "dist" && p !== "node_modules" && p !== "src";
  });
  return parts[0] ?? trimmed;
}
function skipFlagValues(args, flagsWithVals) {
  const out = [];
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (a === "--") {
      for (const rest of args.slice(i + 1)) out.push(rest);
      break;
    }
    if (a.startsWith("--") && a.includes("=")) continue;
    if (flagsWithVals.includes(a)) {
      if (i + 1 < args.length) skipNext = true;
      continue;
    }
    out.push(a);
  }
  return out;
}
function firstNonFlagOperand(args, flagsWithVals) {
  return positionalOperands(args, flagsWithVals)[0] ?? null;
}
function singleNonFlagOperand(args, flagsWithVals) {
  const operands = positionalOperands(args, flagsWithVals);
  if (operands.length !== 1) return null;
  return operands[0];
}
function positionalOperands(args, flagsWithVals) {
  const out = [];
  let afterDoubleDash = false;
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (afterDoubleDash) {
      out.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (arg.startsWith("--") && arg.includes("=")) continue;
    if (flagsWithVals.includes(arg)) {
      if (i + 1 < args.length) skipNext = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    out.push(arg);
  }
  return out;
}
function parseGrepLike(mainCmd, args) {
  const argsNoConnector = trimAtConnector(args);
  const operands = [];
  let pattern = null;
  let afterDoubleDash = false;
  const valueFlags = /* @__PURE__ */ new Set([
    "-e",
    "--regexp",
    "-f",
    "--file",
    "-m",
    "--max-count",
    "-C",
    "--context",
    "-A",
    "--after-context",
    "-B",
    "--before-context"
  ]);
  for (let i = 0; i < argsNoConnector.length; i++) {
    const arg = argsNoConnector[i];
    if (afterDoubleDash) {
      operands.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (arg === "-e" || arg === "--regexp" || arg === "-f" || arg === "--file") {
      const next = argsNoConnector[i + 1];
      if (next !== void 0 && pattern === null) pattern = next;
      if (valueFlags.has(arg)) i++;
      continue;
    }
    if (valueFlags.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    operands.push(arg);
  }
  const hasPattern = pattern !== null;
  const query = pattern ?? operands[0] ?? null;
  const pathIndex = hasPattern ? 0 : 1;
  const path = operands[pathIndex] !== void 0 ? shortDisplayPath(operands[pathIndex]) : null;
  return { type: "search", cmd: shlexJoin(mainCmd), query, path };
}
function awkDataFileOperand(args) {
  if (args.length === 0) return null;
  const argsNoConnector = trimAtConnector(args);
  const hasScriptFile = argsNoConnector.some((arg) => arg === "-f" || arg === "--file");
  const candidates = skipFlagValues(argsNoConnector, [
    "-F",
    "-v",
    "-f",
    "--field-separator",
    "--assign",
    "--file"
  ]);
  const nonFlags = candidates.filter((arg) => !arg.startsWith("-"));
  if (hasScriptFile) return nonFlags[0] ?? null;
  if (nonFlags.length >= 2) return nonFlags[1];
  return null;
}
function pythonWalksFiles(args) {
  const argsNoConnector = trimAtConnector(args);
  for (let i = 0; i < argsNoConnector.length; i++) {
    if (argsNoConnector[i] === "-c") {
      const script = argsNoConnector[i + 1];
      if (script === void 0) return false;
      return script.includes("os.walk") || script.includes("os.listdir") || script.includes("os.scandir") || script.includes("glob.glob") || script.includes("glob.iglob") || script.includes("pathlib.Path") || script.includes(".rglob(");
    }
  }
  return false;
}
function isPythonCommand(cmd) {
  return cmd === "python" || cmd === "python2" || cmd === "python3" || cmd.startsWith("python2.") || cmd.startsWith("python3.");
}
function cdTarget(args) {
  if (args.length === 0) return null;
  let target = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return args[i + 1] ?? null;
    if (arg === "-L" || arg === "-P") continue;
    if (arg.startsWith("-")) continue;
    target = arg;
  }
  return target;
}
function isPathish(s) {
  return s === "." || s === ".." || s.startsWith("./") || s.startsWith("../") || s.includes("/") || s.includes("\\");
}
function parseFdQueryAndPath(tail) {
  const argsNoConnector = trimAtConnector(tail);
  const candidates = skipFlagValues(argsNoConnector, [
    "-t",
    "--type",
    "-e",
    "--extension",
    "-E",
    "--exclude",
    "--search-path"
  ]);
  const nonFlags = candidates.filter((p) => !p.startsWith("-"));
  if (nonFlags.length === 1) {
    const one = nonFlags[0];
    if (isPathish(one)) return [null, shortDisplayPath(one)];
    return [one, null];
  }
  if (nonFlags.length >= 2) return [nonFlags[0], shortDisplayPath(nonFlags[1])];
  return [null, null];
}
function parseFindQueryAndPath(tail) {
  const argsNoConnector = trimAtConnector(tail);
  let path = null;
  for (const a of argsNoConnector) {
    if (!a.startsWith("-") && a !== "!" && a !== "(" && a !== ")") {
      path = shortDisplayPath(a);
      break;
    }
  }
  let query = null;
  for (let i = 0; i < argsNoConnector.length; i++) {
    const a = argsNoConnector[i];
    if (a === "-name" || a === "-iname" || a === "-path" || a === "-regex") {
      if (i + 1 < argsNoConnector.length) query = argsNoConnector[i + 1];
      break;
    }
  }
  return [query, path];
}
function parseShellLcCommands(original) {
  const extracted = extractBashCommand(original);
  if (extracted === null) return null;
  return parseShellScript(extracted[1]);
}
function parseShellScript(script) {
  const allCommands = parseShellScriptIntoCommands(script);
  if (allCommands !== null && allCommands.length > 0) {
    const scriptTokens = shlexSplit(script) ?? [script];
    const hadMultipleCommands = allCommands.length > 1;
    const filteredCommands = dropSmallFormattingCommands(allCommands);
    if (filteredCommands.length === 0) {
      return [{ type: "unknown", cmd: script }];
    }
    const commands = [];
    let cwd = null;
    for (const tokens of filteredCommands) {
      if (tokens[0] === "cd") {
        const dir = cdTarget(tokens.slice(1));
        if (dir !== null) {
          cwd = cwd === null ? dir : joinPaths(cwd, dir);
        }
        continue;
      }
      const parsed = summarizeMainTokens(tokens);
      if (parsed.type === "read" && cwd !== null) {
        commands.push({
          ...parsed,
          path: joinPaths(cwd, parsed.path)
        });
      } else {
        commands.push(parsed);
      }
    }
    if (commands.length > 1) {
      const kept = commands.filter(
        (pc) => !(pc.type === "unknown" && pc.cmd === "true")
      );
      commands.length = 0;
      commands.push(...kept);
      for (; ; ) {
        const next = simplifyOnce(commands);
        if (next === null) break;
        commands.length = 0;
        commands.push(...next);
      }
    }
    if (commands.length === 1) {
      const hadConnectors = hadMultipleCommands || scriptTokens.some((t) => t === "|" || t === "&&" || t === "||" || t === ";");
      const pc = commands[0];
      if (pc.type === "read") {
        if (hadConnectors) {
          const hasPipe = scriptTokens.some((t) => t === "|");
          const hasSedN = scriptTokens.some(
            (t, i) => t === "sed" && scriptTokens[i + 1] === "-n"
          );
          if (hasPipe && hasSedN) {
            commands[0] = { ...pc, cmd: script };
          }
        } else {
          commands[0] = { ...pc, cmd: shlexJoin(scriptTokens) };
        }
      } else if (pc.type === "list_files") {
        if (!hadConnectors) {
          commands[0] = { ...pc, cmd: shlexJoin(scriptTokens) };
        }
      } else if (pc.type === "search") {
        if (!hadConnectors) {
          commands[0] = { ...pc, cmd: shlexJoin(scriptTokens) };
        }
      }
    }
    return commands;
  }
  return [{ type: "unknown", cmd: script }];
}
function isSmallFormattingCommand(tokens) {
  if (tokens.length === 0) return false;
  const cmd = tokens[0];
  switch (cmd) {
    // Always formatting; typically used in pipes.
    // `nl` is special-cased to allow `nl <file>` to be treated as a read command.
    case "wc":
    case "tr":
    case "cut":
    case "sort":
    case "uniq":
    case "tee":
    case "column":
    case "yes":
    case "printf":
      return true;
    case "xargs":
      return !isMutatingXargsCommand(tokens);
    case "awk":
      return awkDataFileOperand(tokens.slice(1)) === null;
    case "head": {
      if (tokens.length === 1) return true;
      if (tokens.length === 2) return tokens[1].startsWith("-");
      if (tokens.length === 3) {
        const [flag, count] = [tokens[1], tokens[2]];
        if ((flag === "-n" || flag === "-c") && /^[0-9]+$/.test(count)) return true;
      }
      return false;
    }
    case "tail": {
      if (tokens.length === 1) return true;
      if (tokens.length === 2) return tokens[1].startsWith("-");
      if (tokens.length === 3) {
        const [flag, count] = [tokens[1], tokens[2]];
        if (flag === "-n" || flag === "-c") {
          const digits = count.startsWith("+") ? count.slice(1) : count;
          if (/^[0-9]+$/.test(digits)) return true;
        }
      }
      return false;
    }
    case "sed": {
      const args = tokens.slice(1);
      return !sedHasInPlaceFlag(args) && sedReadPath(args) === null;
    }
    default:
      return false;
  }
}
function isMutatingXargsCommand(tokens) {
  const sub = xargsSubcommand(tokens);
  return sub !== null && xargsIsMutatingSubcommand(sub);
}
function xargsSubcommand(tokens) {
  if (tokens[0] !== "xargs") return null;
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "--") {
      const rest = tokens.slice(i + 1);
      return rest.length > 0 ? rest : null;
    }
    if (!token.startsWith("-")) {
      const rest = tokens.slice(i);
      return rest.length > 0 ? rest : null;
    }
    const takesValue = ["-E", "-e", "-I", "-L", "-n", "-P", "-s"].includes(token);
    if (takesValue && token.length === 2) {
      i += 2;
    } else {
      i += 1;
    }
  }
  return null;
}
function xargsIsMutatingSubcommand(tokens) {
  if (tokens.length === 0) return false;
  const [head, ...tail] = tokens;
  switch (head) {
    case "perl":
    case "ruby":
      return hasInPlaceFlag(tail);
    case "sed":
      return sedHasInPlaceFlag(tail);
    case "rg":
      return tail.some((token) => token === "--replace");
    default:
      return false;
  }
}
function hasInPlaceFlag(tokens) {
  return tokens.some(
    (token) => token === "-i" || token.startsWith("-i") || token === "-pi" || token.startsWith("-pi") || token === "--in-place" || token.startsWith("--in-place=")
  );
}
function dropSmallFormattingCommands(commands) {
  return commands.filter((tokens) => !isSmallFormattingCommand(tokens));
}
function summarizeMainTokens(mainCmd) {
  const head = mainCmd[0];
  const tail = mainCmd.slice(1);
  const join = () => shlexJoin(mainCmd);
  if (head === void 0) return { type: "unknown", cmd: join() };
  if (head === "ls" || head === "eza" || head === "exa") {
    const flagsWithVals = head === "ls" ? ["-I", "-w", "--block-size", "--format", "--time-style", "--color", "--quoting-style"] : ["-I", "--ignore-glob", "--color", "--sort", "--time-style", "--time"];
    const p = firstNonFlagOperand(tail, flagsWithVals);
    return { type: "list_files", cmd: join(), path: p !== null ? shortDisplayPath(p) : null };
  }
  if (head === "tree") {
    const p = firstNonFlagOperand(tail, ["-L", "-P", "-I", "--charset", "--filelimit", "--sort"]);
    return { type: "list_files", cmd: join(), path: p !== null ? shortDisplayPath(p) : null };
  }
  if (head === "du") {
    const p = firstNonFlagOperand(tail, [
      "-d",
      "--max-depth",
      "-B",
      "--block-size",
      "--exclude",
      "--time-style"
    ]);
    return { type: "list_files", cmd: join(), path: p !== null ? shortDisplayPath(p) : null };
  }
  if (head === "rg" || head === "rga" || head === "ripgrep-all") {
    const argsNoConnector = trimAtConnector(tail);
    const hasFilesFlag = argsNoConnector.some((a) => a === "--files");
    const candidates = skipFlagValues(argsNoConnector, [
      "-g",
      "--glob",
      "--iglob",
      "-t",
      "--type",
      "--type-add",
      "--type-not",
      "-m",
      "--max-count",
      "-A",
      "-B",
      "-C",
      "--context",
      "--max-depth"
    ]);
    const nonFlags = candidates.filter((p2) => !p2.startsWith("-"));
    if (hasFilesFlag) {
      const p2 = nonFlags[0];
      return { type: "list_files", cmd: join(), path: p2 !== void 0 ? shortDisplayPath(p2) : null };
    }
    const query = nonFlags[0] ?? null;
    const p = nonFlags[1];
    return { type: "search", cmd: join(), query, path: p !== void 0 ? shortDisplayPath(p) : null };
  }
  if (head === "git") {
    const subcmd = tail[0];
    const subTail = tail.slice(1);
    if (subcmd === "grep") return parseGrepLike(mainCmd, subTail);
    if (subcmd === "ls-files") {
      const p = firstNonFlagOperand(subTail, [
        "--exclude",
        "--exclude-from",
        "--pathspec-from-file"
      ]);
      return { type: "list_files", cmd: join(), path: p !== null ? shortDisplayPath(p) : null };
    }
    return { type: "unknown", cmd: join() };
  }
  if (head === "fd") {
    const [query, path] = parseFdQueryAndPath(tail);
    if (query !== null) return { type: "search", cmd: join(), query, path };
    return { type: "list_files", cmd: join(), path };
  }
  if (head === "find") {
    const [query, path] = parseFindQueryAndPath(tail);
    if (query !== null) return { type: "search", cmd: join(), query, path };
    return { type: "list_files", cmd: join(), path };
  }
  if (head === "grep" || head === "egrep" || head === "fgrep") {
    return parseGrepLike(mainCmd, tail);
  }
  if (head === "ag" || head === "ack" || head === "pt") {
    const argsNoConnector = trimAtConnector(tail);
    const candidates = skipFlagValues(argsNoConnector, [
      "-G",
      "-g",
      "--file-search-regex",
      "--ignore-dir",
      "--ignore-file",
      "--path-to-ignore"
    ]);
    const nonFlags = candidates.filter((p2) => !p2.startsWith("-"));
    const query = nonFlags[0] ?? null;
    const p = nonFlags[1];
    return { type: "search", cmd: join(), query, path: p !== void 0 ? shortDisplayPath(p) : null };
  }
  if (head === "cat" || head.toLowerCase() === "get-content") {
    let path;
    if (head === "cat") {
      path = singleNonFlagOperand(tail, []);
    } else {
      const allowedFlags = ["-raw", "-path", "-literalpath"];
      const simple = tail.every(
        (argument) => !argument.startsWith("-") || allowedFlags.includes(argument.toLowerCase())
      ) ? singleNonFlagOperand(tail, []) : null;
      path = simple !== null && simple !== "" && !simple.startsWith("-") && [...simple].every(
        (character) => /[\p{L}\p{N}]/u.test(character) || " /\\.-_:".includes(character)
      ) ? simple : null;
    }
    if (path !== null) {
      return { type: "read", cmd: join(), name: shortDisplayPath(path), path };
    }
    return { type: "unknown", cmd: join() };
  }
  if (head === "bat" || head === "batcat") {
    const p = singleNonFlagOperand(tail, [
      "--theme",
      "--language",
      "--style",
      "--terminal-width",
      "--tabs",
      "--line-range",
      "--map-syntax"
    ]);
    if (p !== null) return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
    return { type: "unknown", cmd: join() };
  }
  if (head === "less") {
    const p = singleNonFlagOperand(tail, [
      "-p",
      "-P",
      "-x",
      "-y",
      "-z",
      "-j",
      "--pattern",
      "--prompt",
      "--tabs",
      "--shift",
      "--jump-target"
    ]);
    if (p !== null) return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
    return { type: "unknown", cmd: join() };
  }
  if (head === "more") {
    const p = singleNonFlagOperand(tail, []);
    if (p !== null) return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
    return { type: "unknown", cmd: join() };
  }
  if (head === "head") {
    let hasValidN = false;
    if (tail[0] === "-n") {
      hasValidN = tail[1] !== void 0 && /^[0-9]+$/.test(tail[1]);
    } else if (tail[0]?.startsWith("-n")) {
      hasValidN = /^[0-9]+$/.test(tail[0].slice(2));
    }
    if (hasValidN) {
      const candidates = [];
      let i = 0;
      while (i < tail.length) {
        if (i === 0 && tail[i] === "-n" && i + 1 < tail.length) {
          const n = tail[i + 1];
          if (/^[0-9]+$/.test(n)) {
            i += 2;
            continue;
          }
        }
        candidates.push(tail[i]);
        i += 1;
      }
      const p = candidates.find((p2) => !p2.startsWith("-"));
      if (p !== void 0) {
        return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
      }
    }
    if (tail.length === 1 && !tail[0].startsWith("-")) {
      return { type: "read", cmd: join(), name: shortDisplayPath(tail[0]), path: tail[0] };
    }
    return { type: "unknown", cmd: join() };
  }
  if (head === "tail") {
    const validCount = (s) => {
      const digits = s.startsWith("+") ? s.slice(1) : s;
      return digits !== "" && /^[0-9]+$/.test(digits);
    };
    let hasValidN = false;
    if (tail[0] === "-n") {
      hasValidN = tail[1] !== void 0 && validCount(tail[1]);
    } else if (tail[0]?.startsWith("-n")) {
      hasValidN = validCount(tail[0].slice(2));
    }
    if (hasValidN) {
      const candidates = [];
      let i = 0;
      while (i < tail.length) {
        if (i === 0 && tail[i] === "-n" && i + 1 < tail.length) {
          const n = tail[i + 1];
          if (validCount(n)) {
            i += 2;
            continue;
          }
        }
        candidates.push(tail[i]);
        i += 1;
      }
      const p = candidates.find((p2) => !p2.startsWith("-"));
      if (p !== void 0) {
        return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
      }
    }
    if (tail.length === 1 && !tail[0].startsWith("-")) {
      return { type: "read", cmd: join(), name: shortDisplayPath(tail[0]), path: tail[0] };
    }
    return { type: "unknown", cmd: join() };
  }
  if (head === "awk") {
    const p = awkDataFileOperand(tail);
    if (p !== null) return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
    return { type: "unknown", cmd: join() };
  }
  if (head === "nl") {
    const candidates = skipFlagValues(tail, ["-s", "-w", "-v", "-i", "-b"]);
    const p = candidates.find((p2) => !p2.startsWith("-"));
    if (p !== void 0) {
      return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
    }
    return { type: "unknown", cmd: join() };
  }
  if (head === "sed") {
    const p = sedReadPath(tail);
    if (p !== null) return { type: "read", cmd: join(), name: shortDisplayPath(p), path: p };
    return { type: "unknown", cmd: join() };
  }
  if (isPythonCommand(head)) {
    if (pythonWalksFiles(tail)) {
      return { type: "list_files", cmd: join(), path: null };
    }
    return { type: "unknown", cmd: join() };
  }
  return { type: "unknown", cmd: join() };
}
function isAbsLike(path) {
  if (path.startsWith("/")) return true;
  if (/^[A-Za-z]:\\/.test(path)) return true;
  if (path.startsWith("\\\\")) return true;
  return false;
}
function joinPaths(base, rel) {
  if (isAbsLike(rel)) return rel;
  if (base === "") return rel;
  return base.endsWith("/") ? base + rel : base + "/" + rel;
}
function parseCommandImpl(command) {
  const shellLc = parseShellLcCommands(command);
  if (shellLc !== null) return shellLc;
  const head = command[0];
  const powershellCommand = head !== void 0 && head.includes("\\") ? command.map((t, i) => i === 0 ? head.split(/[\\/]/).pop() ?? head : t) : null;
  const ps = extractPowershellCommand(powershellCommand ?? command);
  if (ps !== null) {
    const [, script] = ps;
    const tokens = tokenizePowershellCommand(script);
    const innerParsed = parseCommandImpl(tokens);
    if (tokens[0] === "Get-Content" && innerParsed.length === 1 && innerParsed[0].type === "read") {
      const inner = innerParsed[0];
      return [{ type: "read", cmd: script, name: inner.name, path: inner.path }];
    }
    return [{ type: "unknown", cmd: script }];
  }
  const normalized = normalizeTokens(command);
  const parts = containsConnectors(normalized) ? splitOnConnectors(normalized) : [normalized];
  const commands = [];
  let cwd = null;
  for (const tokens of parts) {
    if (tokens[0] === "cd") {
      const dir = cdTarget(tokens.slice(1));
      if (dir !== null) {
        cwd = cwd === null ? dir : joinPaths(cwd, dir);
      }
      continue;
    }
    const parsed = summarizeMainTokens(tokens);
    if (parsed.type === "read" && cwd !== null) {
      commands.push({ ...parsed, path: joinPaths(cwd, parsed.path) });
    } else {
      commands.push(parsed);
    }
  }
  for (; ; ) {
    const next = simplifyOnce(commands);
    if (next === null) break;
    commands.length = 0;
    commands.push(...next);
  }
  return commands;
}

// src/approvalEvidence.ts
function issueApprovalEvidence(input) {
  if (!Number.isFinite(input.issuedAt) || !Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new RangeError("issuedAt and ttlMs must be finite, with ttlMs > 0");
  }
  if (!input.resourceFingerprint) throw new TypeError("resourceFingerprint is required");
  return {
    resourceFingerprint: input.resourceFingerprint,
    decision: input.decision,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlMs
  };
}
function validateApprovalEvidence(evidence, request) {
  if (!Number.isFinite(evidence.issuedAt) || !Number.isFinite(evidence.expiresAt) || evidence.expiresAt <= evidence.issuedAt) return { ok: false, reason: "invalid-window" };
  if (evidence.revokedAt !== void 0 && (!Number.isFinite(evidence.revokedAt) || evidence.revokedAt < evidence.issuedAt)) return { ok: false, reason: "invalid-window" };
  if (evidence.revokedAt !== void 0 && request.now >= evidence.revokedAt) return { ok: false, reason: "revoked" };
  if (request.now < evidence.issuedAt) return { ok: false, reason: "not-yet-valid" };
  if (evidence.resourceFingerprint !== request.resourceFingerprint) return { ok: false, reason: "resource-mismatch" };
  if (evidence.decision !== request.decision) return { ok: false, reason: "decision-mismatch" };
  if (request.now >= evidence.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

// src/canonicalization.ts
var SH_SCRIPT_PREFIX = "__codex_shell_script__";
var PS_SCRIPT_PREFIX = "__codex_powershell_script__";
var SHELL_BASENAMES = /* @__PURE__ */ new Set(["sh", "bash", "zsh"]);
function basename(raw) {
  const name2 = raw.split(/[\\/]/).pop() ?? "";
  return name2.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}
function extractBashCommand2(argv) {
  if (argv.length !== 3) return null;
  const [shell, flag, script] = argv;
  if (flag !== "-lc" && flag !== "-c") return null;
  if (!SHELL_BASENAMES.has(basename(shell))) return null;
  return { shellMode: flag, script };
}
function extractPowershellCommand2(argv) {
  if (argv.length !== 3) return null;
  const [shell, flag, script] = argv;
  const base = basename(shell);
  if (base !== "powershell" && base !== "pwsh" || flag.toLowerCase() !== "-command") return null;
  return { script };
}
function isPlainWordToken(token) {
  return !/['"`$<>&;|*?~(){}\n\r]/.test(token) && !/^\s*#/.test(token);
}
function parsePlainCommandScript(script) {
  const segments = script.split(/\r?\n|\|\||&&|\||;/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const commands = [];
  for (const seg of segments) {
    const words = seg.split(/\s+/);
    if (!words.every(isPlainWordToken) || words.length === 0) return null;
    commands.push(words);
  }
  return commands;
}
function canonicalizeCommandForApproval(argv) {
  if (extractBashCommand2(argv)) {
    const script = argv[2];
    const commands = parsePlainCommandScript(script);
    if (commands && commands.length === 1) return commands[0];
    return [SH_SCRIPT_PREFIX, argv[1], script];
  }
  if (extractPowershellCommand2(argv)) {
    return [PS_SCRIPT_PREFIX, argv[2]];
  }
  return argv;
}

// src/dsh-plugin.ts
var name = "codex-policy-engine";
var inject = ["tools"];
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function isDecision2(value) {
  return value === "Allow" || value === "Forbidden" || value === "Prompt";
}
function isAbortSignal(value) {
  return value instanceof AbortSignal;
}
function isDecisionAdapter(value) {
  return Boolean(value && typeof value === "object" && typeof value.decide === "function");
}
function isRuntimeObserver(value) {
  return Boolean(value && typeof value === "object" && typeof value.observe === "function");
}
function decisionInput(exec) {
  if (typeof exec.callId !== "string" || typeof exec.rootCallId !== "string" || typeof exec.name !== "string" || !isAbortSignal(exec.signal)) return null;
  return {
    callId: exec.callId,
    rootCallId: exec.rootCallId,
    toolName: exec.name,
    arguments: exec.arguments,
    signal: exec.signal
  };
}
function mapExtensionDecision(decision, next) {
  switch (decision.kind) {
    case "delegate":
      return next();
    case "deny":
      return { kind: "deny", reason: decision.reason };
    case "ask":
      return decision.reason === void 0 ? { kind: "ask" } : { kind: "ask", reason: decision.reason };
  }
}
function tokenizeCommand(line) {
  if (typeof line !== "string") return [];
  const out = [];
  let cur = "";
  let q = null;
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function policyFromConfig(config = {}) {
  const cfg = asRecord(config);
  const policy = new Policy();
  const normToken = (t) => {
    if (typeof t === "string") return singleToken(t);
    if (Array.isArray(t)) return altsToken(t.map(String));
    if (t && typeof t === "object") {
      const token = t;
      if (token.kind === "Single" && typeof token.value === "string") return token;
      if (token.kind === "Alts" && Array.isArray(token.values)) {
        return altsToken(token.values.map(String));
      }
    }
    return null;
  };
  for (const rawRule of Array.isArray(cfg.rules) ? cfg.rules : []) {
    const rule = asRecord(rawRule);
    if (!rule.first || !isDecision2(rule.decision)) continue;
    const rest = [];
    for (const raw of Array.isArray(rule.rest) ? rule.rest : []) {
      const t = normToken(raw);
      if (t) rest.push(t);
    }
    policy.addPrefixRule({ first: String(rule.first), rest, decision: rule.decision });
  }
  return policy;
}
function evaluate(policy, line) {
  return policy.check(tokenizeCommand(line));
}
function evaluateCached(policy, line, cache) {
  const argv = tokenizeCommand(line);
  const key = canonicalizeCommandForApproval(argv).join("\0");
  if (cache?.has(key)) return cache.get(key);
  const ev = policy.check(argv);
  cache?.set(key, ev);
  return ev;
}
function apply(ctx, config = {}) {
  const cfg = asRecord(config);
  const mode = cfg.mode === "enforce" || cfg.mode === "audit" ? cfg.mode : "off";
  const patterns = Array.isArray(cfg.commandTools) && cfg.commandTools.length ? cfg.commandTools.map(String) : ["bash", "pwsh", "*-bash*", "*-pwsh*", "shell", "terminal*"];
  const wildcard = (pattern, value) => {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${esc}$`, "i").test(String(value ?? ""));
  };
  const isCommandTool = (toolName) => patterns.some((p) => wildcard(p, toolName));
  const decisionAdapter = isDecisionAdapter(cfg.decisionAdapter) ? cfg.decisionAdapter : void 0;
  const runtimeObserver = isRuntimeObserver(cfg.runtimeObserver) ? cfg.runtimeObserver : void 0;
  const policy = policyFromConfig(cfg);
  const approvalCache = /* @__PURE__ */ new Map();
  try {
    if (ctx?.tools?.register) {
      const defineTool = (definition) => definition;
      ctx.tools.register(defineTool({
        name: "codex_policy_check",
        description: "Evaluate a command line against the codex-policy-engine approval rules. Read-only.",
        parameters: {
          command: { type: "string", required: true, description: "raw command line to evaluate" }
        },
        output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
        async execute(args) {
          const ev = evaluate(policy, String(args?.command ?? ""));
          return JSON.stringify({ command: args?.command, decision: ev.decision, matchedPrograms: ev.matchedPrograms });
        },
        timeoutMs: 3e3
      }));
      const safetyPlatformDefault = process.platform === "win32" ? "windows" : "posix";
      ctx.tools.register(defineTool({
        name: "codex_command_safety_check",
        description: "Classify a command line with the ported openai/codex dangerous-command heuristics (forced rm, sudo/env/trap wrappers, sh -c literals, Windows ShellExecute/URL and force-delete patterns). Read-only.",
        parameters: {
          command: { type: "string", required: true, description: "raw command line to classify" }
        },
        output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
        async execute(args) {
          const command = String(args?.command ?? "");
          const match = dangerousCommandMatchLine(command, { platform: safetyPlatformDefault });
          return JSON.stringify({ command: args?.command, platform: safetyPlatformDefault, match: match ?? null });
        },
        timeoutMs: 3e3
      }));
    }
  } catch {
  }
  if (typeof ctx?.on !== "function") return;
  if (runtimeObserver) {
    ctx.on("tools/result", (exec, result) => {
      if (typeof exec.callId !== "string" || typeof exec.rootCallId !== "string" || typeof exec.name !== "string") return;
      void Promise.resolve(runtimeObserver.observe({
        callId: exec.callId,
        rootCallId: exec.rootCallId,
        toolName: exec.name,
        result
      })).catch(() => void 0);
    });
  }
  if (mode === "off" && !decisionAdapter) return;
  ctx.on("tools/pre-execute", (exec, next) => {
    if (decisionAdapter) {
      const input = decisionInput(exec);
      if (!input) {
        return { kind: "deny", reason: "[codex-policy-engine] extension decision requires callId, rootCallId, toolName, and AbortSignal" };
      }
      if (input.signal.aborted) {
        return { kind: "deny", reason: "[codex-policy-engine] extension decision cancelled before evaluation" };
      }
      return Promise.resolve().then(() => decisionAdapter.decide(input)).then((decision) => mapExtensionDecision(decision, next)).catch((error) => ({
        kind: "deny",
        reason: `[codex-policy-engine] extension decision failed closed: ${error instanceof Error ? error.message : String(error)}`
      }));
    }
    if (!isCommandTool(exec?.name)) return next();
    const line = String(asRecord(exec?.arguments).command ?? "");
    if (!line.trim()) return next();
    const safetyMode = cfg.commandSafety === "audit" || cfg.commandSafety === "enforce" ? cfg.commandSafety : "off";
    if (safetyMode !== "off") {
      const safetyPlatform = cfg.commandSafetyPlatform === "posix" || cfg.commandSafetyPlatform === "windows" ? cfg.commandSafetyPlatform : process.platform === "win32" ? "windows" : "posix";
      const dangerous = dangerousCommandMatchLine(line, { platform: safetyPlatform });
      if (dangerous && safetyMode === "enforce") {
        if (dangerous === "ForcedRm") {
          return { kind: "deny", reason: "[codex-policy-engine] forced removal rejected by command-safety classifier" };
        }
        return { kind: "ask", reason: `[codex-policy-engine] command matches dangerous-command heuristics \`${line}\`` };
      }
    }
    const ev = evaluateCached(policy, line, approvalCache);
    if (ev.decision === "Allow") return next();
    if (ev.decision === "Forbidden") {
      return { kind: "deny", reason: `[codex-policy-engine] forbidden by rule (matched: ${ev.matchedPrograms.join(", ") || "none"})` };
    }
    if (mode === "audit") return next();
    return { kind: "ask", reason: `[codex-policy-engine] no allow rule matched \`${line}\`` };
  }, { prepend: true });
}
export {
  Policy,
  altsToken,
  apply,
  approxBytesForTokens,
  approxTokenCount,
  approxTokensFromByteCount,
  dangerousCommandMatch,
  evaluate,
  evaluateCached,
  executableBasename,
  executableNameLookupKey,
  extractBashCommand,
  formattedTruncateText,
  inject,
  isDangerousCommandWindows,
  isDangerousPowershellWords,
  isPathish,
  isSmallFormattingCommand,
  issueApprovalEvidence,
  maxDecision,
  name,
  parseCommand,
  parseCommandImpl,
  parsePolicyFile,
  parseShellLcPlainCommands,
  parseShellScript,
  parseShellScriptIntoCommands,
  policyFromConfig,
  prefixRule,
  shlexJoin,
  shlexSplit,
  shlexSplitSafe,
  singleToken,
  splitInvocationSegments,
  tokenizeCommand,
  truncateFunctionOutputItems,
  truncateMiddleChars,
  truncateMiddleWithTokenBudget,
  truncateText,
  validateApprovalEvidence
};
