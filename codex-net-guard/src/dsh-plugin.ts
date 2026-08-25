// dsh plugin entry for codex-net-guard (pure-JS whitelist proxy for agent sandboxes)
import { createWhitelistProxy } from './index.js';

export const name = 'codex-net-guard'
export const inject = ['tools']

function asRecord(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {} }

let active = null // { proxy, startedAt, domains }

async function listenReady(proxy) {
  await new Promise((resolveP, rejectP) => {
    if (proxy.port() > 0) return resolveP()
    proxy.server.once('listening', resolveP)
    proxy.server.once('error', rejectP)
  })
}

export async function apply(ctx, config = {}) {
  const cfg = asRecord(config)
  const defaultDomains = Array.isArray(cfg.allowedDomains) ? cfg.allowedDomains.map(String) : []
  const defineTool = (d) => d

  if (cfg.autostart === true && !active && defaultDomains.length) {
    try {
      const proxy = createWhitelistProxy({ allowedDomains: defaultDomains, port: Number(cfg.port ?? 0) })
      await listenReady(proxy)
      active = { proxy, startedAt: new Date().toISOString(), domains: defaultDomains }
    } catch { /* port conflicts must never block boot */ }
  }

  try {
    if (ctx?.tools?.register) {
      ctx.tools.register(defineTool({
        name: 'codex_net_guard',
        description: 'Control a local HTTP/CONNECT whitelist proxy: only allowed domains pass, everything else gets 403. Actions: start/stop/status.',
        parameters: {
          action: { type: 'string', required: true, enum: ['start', 'stop', 'status'] },
          domains: { type: 'array', description: 'suffix-matched allow list, e.g. ["api.deepseek.com","github.com"]' },
          port: { type: 'number', description: 'listen port; 0 = pick a free port (default)' },
        },
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
        async execute(args) {
          const action = String(args?.action ?? 'status')
          if (action === 'status') {
            return JSON.stringify({ running: !!active, url: active?.proxy.url() ?? null, domains: active?.domains ?? defaultDomains, startedAt: active?.startedAt ?? null })
          }
          if (action === 'stop') {
            if (!active) return JSON.stringify({ running: false })
            active.proxy.close(); const stopped = active.proxy.url(); active = null
            return JSON.stringify({ running: false, stopped })
          }
          const domains = (Array.isArray(args?.domains) && args.domains.length ? args.domains : defaultDomains).map(String)
          if (!domains.length) return JSON.stringify({ error: 'no domains configured; pass args.domains or set netGuard.allowedDomains in the patch layer' })
          if (active) active.proxy.close()
          const proxy = createWhitelistProxy({ allowedDomains: domains, port: Number(args?.port ?? cfg.port ?? 0) })
          await listenReady(proxy)
          active = { proxy, startedAt: new Date().toISOString(), domains }
          return JSON.stringify({ running: true, url: active.proxy.url(), domains }, null, 2)
        },
        timeoutMs: 5000,
      }))
    }
  } catch { /* tool seam unavailable */ }
}

export function status() {
  return { running: !!active, url: active?.proxy.url() ?? null, domains: active?.domains ?? [] }
}

export function shutdown() { if (active) { active.proxy.close(); active = null } }

export { createWhitelistProxy }
