// dsh plugin entry for dsh-codex-ui (dashboard for absorbed codex capabilities)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-codex-ui'
export const inject = ['tools']

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prototype');

let server = null
let url = null

function start(port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const s = createServer((req, res) => {
      const f = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0]
      try {
        const body = readFileSync(join(ROOT, f))
        res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/plain' })
        res.end(body)
      } catch { res.writeHead(404); res.end('not found') }
    })
    s.once('error', rejectPromise)
    s.listen(port, '127.0.0.1', () => resolvePromise(s))
  })
}

export async function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  try {
    if (ctx?.tools?.register) {
      const defineTool = (d) => d
      ctx.tools.register(defineTool({
        name: 'codex_ui_url',
        description: 'Start (once) and report the local dsh-codex-ui dashboard URL showing absorbed codex->dsh capabilities.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
        async execute() {
          if (!server) {
            server = await start(Number(cfg.port ?? 7777))
            url = `http://127.0.0.1:${server.address().port}`
          }
          return JSON.stringify({ url })
        },
        timeoutMs: 5000,
      }))
    }
    if (cfg.autostart === true) {
      server = await start(Number(cfg.port ?? 7777))
      url = `http://127.0.0.1:${server.address().port}`
    }
  } catch { /* UI must never block boot */ }
}

export function uiUrl() { return url }

export function shutdown() { if (server) { server.close(); server = null; url = null } }
