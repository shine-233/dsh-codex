// codex-policy-engine/src/decision.ts
var RANK = { Allow: 0, Prompt: 1, Forbidden: 2 };
function maxDecision(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}
function aggregate(decisions) {
  if (decisions.length === 0) return "Prompt";
  return decisions.reduce(maxDecision);
}

// codex-policy-engine/src/rule.ts
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

// codex-policy-engine/src/policy.ts
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

// codex-policy-engine/src/starlarkLite.ts
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

// codex-policy-engine/src/shellParser.ts
function parseShellLine(line) {
  const result = { invocations: [], heredocs: [], substitutions: [], comments: [] };
  if (!line.trim()) return result;
  const argv = [];
  const redirects = [];
  const pushInvocation = () => {
    if (argv.length || redirects.length) result.invocations.push({ argv: [...argv], redirects: [...redirects] });
    argv.length = 0;
    redirects.length = 0;
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

// codex-policy-engine/src/parseCommand/shlex.ts
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

// codex-policy-engine/src/commandSafety.ts
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

// codex-policy-engine/src/canonicalization.ts
var SH_SCRIPT_PREFIX = "__codex_shell_script__";
var PS_SCRIPT_PREFIX = "__codex_powershell_script__";
var SHELL_BASENAMES = /* @__PURE__ */ new Set(["sh", "bash", "zsh"]);
function basename(raw) {
  const name2 = raw.split(/[\\/]/).pop() ?? "";
  return name2.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}
function extractBashCommand(argv) {
  if (argv.length !== 3) return null;
  const [shell, flag, script] = argv;
  if (flag !== "-lc" && flag !== "-c") return null;
  if (!SHELL_BASENAMES.has(basename(shell))) return null;
  return { shellMode: flag, script };
}
function extractPowershellCommand(argv) {
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
  if (extractBashCommand(argv)) {
    const script = argv[2];
    const commands = parsePlainCommandScript(script);
    if (commands && commands.length === 1) return commands[0];
    return [SH_SCRIPT_PREFIX, argv[1], script];
  }
  if (extractPowershellCommand(argv)) {
    return [PS_SCRIPT_PREFIX, argv[2]];
  }
  return argv;
}

// codex-policy-engine/src/dsh-plugin.ts
var name = "codex-policy-engine";
var inject = ["tools"];
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
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
    if (t && typeof t === "object" && (t.kind === "Single" || t.kind === "Alts")) return t;
    return null;
  };
  for (const r of Array.isArray(cfg.rules) ? cfg.rules : []) {
    const rule = asRecord(r);
    if (!rule.first || typeof rule.decision !== "string") continue;
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
  let policy = policyFromConfig(cfg);
  const approvalCache = /* @__PURE__ */ new Map();
  try {
    if (ctx?.tools?.register) {
      const defineTool = (d) => d;
      ctx.tools.register(defineTool({
        name: "codex_policy_check",
        description: "Evaluate a command line against the codex-policy-engine approval rules. Read-only.",
        parameters: {
          command: { type: "string", required: true, description: "raw command line to evaluate" }
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
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
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args) {
          const argv = tokenizeCommand(String(args?.command ?? ""));
          const match = dangerousCommandMatch(argv, { platform: safetyPlatformDefault });
          return JSON.stringify({ command: args?.command, platform: safetyPlatformDefault, match: match ?? null });
        },
        timeoutMs: 3e3
      }));
    }
  } catch {
  }
  if (mode === "off" || typeof ctx?.on !== "function") return;
  ctx.on("tools/pre-execute", (exec, next) => {
    if (!isCommandTool(exec?.name)) return next();
    const argv0 = String(exec?.name ?? "");
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
    const ev = evaluateCached(policy, line);
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
  evaluate,
  evaluateCached,
  inject,
  name,
  parsePolicyFile,
  policyFromConfig,
  prefixRule,
  tokenizeCommand
};
