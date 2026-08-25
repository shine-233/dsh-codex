// ../codex-net-guard/src/index.ts
import * as http from "node:http";
import * as net from "node:net";
function matchesDomain(host, pattern) {
  const h = host.toLowerCase().replace(/:.*$/, "");
  const p = pattern.toLowerCase();
  return h === p || h.endsWith("." + p);
}
function createWhitelistProxy(opts) {
  const resolve = opts.resolve ?? ((host) => ({ host, port: 443 }));
  const isAllowed = (h) => opts.allowedDomains.some((p) => matchesDomain(h, p));
  const server = http.createServer((req, res) => {
    let host = "";
    try {
      host = new URL(req.url ?? "/", "http://placeholder.invalid").hostname;
    } catch {
      host = String(req.headers.host ?? "");
    }
    if (!isAllowed(host)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("net-guard: blocked " + host);
      return;
    }
    const t = resolve(host);
    const fwd = http.request({
      host: t.host,
      port: t.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host }
    }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    fwd.on("error", () => {
      res.writeHead(502);
      res.end("net-guard: bad gateway");
    });
    req.pipe(fwd);
  });
  server.on("connect", (req, socket, head) => {
    const host = (req.url ?? "").split(":")[0];
    if (!isAllowed(host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\nnblocked by net-guard");
      socket.destroy();
      return;
    }
    const t = resolve(host);
    const up = net.connect(t.port, t.host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  server.listen(opts.port ?? 0, "127.0.0.1");
  const addr = () => {
    const a = server.address();
    return typeof a === "object" && a ? a.port : Number(opts.port);
  };
  return { server, url: () => `http://127.0.0.1:${addr()}`, port: addr, close: () => server.close() };
}

// ../codex-net-guard/src/dsh-plugin.ts
var name = "codex-net-guard";
var inject = ["tools"];
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
var active = null;
async function listenReady(proxy) {
  await new Promise((resolveP, rejectP) => {
    if (proxy.port() > 0) return resolveP();
    proxy.server.once("listening", resolveP);
    proxy.server.once("error", rejectP);
  });
}
async function apply(ctx, config = {}) {
  const cfg = asRecord(config);
  const defaultDomains = Array.isArray(cfg.allowedDomains) ? cfg.allowedDomains.map(String) : [];
  const defineTool = (d) => d;
  if (cfg.autostart === true && !active && defaultDomains.length) {
    try {
      const proxy = createWhitelistProxy({ allowedDomains: defaultDomains, port: Number(cfg.port ?? 0) });
      await listenReady(proxy);
      active = { proxy, startedAt: (/* @__PURE__ */ new Date()).toISOString(), domains: defaultDomains };
    } catch {
    }
  }
  try {
    if (ctx?.tools?.register) {
      ctx.tools.register(defineTool({
        name: "codex_net_guard",
        description: "Control a local HTTP/CONNECT whitelist proxy: only allowed domains pass, everything else gets 403. Actions: start/stop/status.",
        parameters: {
          action: { type: "string", required: true, enum: ["start", "stop", "status"] },
          domains: { type: "array", description: 'suffix-matched allow list, e.g. ["api.deepseek.com","github.com"]' },
          port: { type: "number", description: "listen port; 0 = pick a free port (default)" }
        },
        output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
        async execute(args) {
          const action = String(args?.action ?? "status");
          if (action === "status") {
            return JSON.stringify({ running: !!active, url: active?.proxy.url() ?? null, domains: active?.domains ?? defaultDomains, startedAt: active?.startedAt ?? null });
          }
          if (action === "stop") {
            if (!active) return JSON.stringify({ running: false });
            active.proxy.close();
            const stopped = active.proxy.url();
            active = null;
            return JSON.stringify({ running: false, stopped });
          }
          const domains = (Array.isArray(args?.domains) && args.domains.length ? args.domains : defaultDomains).map(String);
          if (!domains.length) return JSON.stringify({ error: "no domains configured; pass args.domains or set netGuard.allowedDomains in the patch layer" });
          if (active) active.proxy.close();
          const proxy = createWhitelistProxy({ allowedDomains: domains, port: Number(args?.port ?? cfg.port ?? 0) });
          await listenReady(proxy);
          active = { proxy, startedAt: (/* @__PURE__ */ new Date()).toISOString(), domains };
          return JSON.stringify({ running: true, url: active.proxy.url(), domains }, null, 2);
        },
        timeoutMs: 5e3
      }));
    }
  } catch {
  }
}
function status() {
  return { running: !!active, url: active?.proxy.url() ?? null, domains: active?.domains ?? [] };
}
function shutdown() {
  if (active) {
    active.proxy.close();
    active = null;
  }
}
export {
  apply,
  createWhitelistProxy,
  inject,
  name,
  shutdown,
  status
};
