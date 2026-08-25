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

// src/dsh-plugin.ts
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
    }
  } catch {
  }
  if (mode === "off" || typeof ctx?.on !== "function") return;
  ctx.on("tools/pre-execute", (exec, next) => {
    if (!isCommandTool(exec?.name)) return next();
    const argv0 = String(exec?.name ?? "");
    const line = String(asRecord(exec?.arguments).command ?? "");
    if (!line.trim()) return next();
    const ev = evaluate(policy, line);
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
  inject,
  name,
  parsePolicyFile,
  policyFromConfig,
  prefixRule,
  tokenizeCommand
};
