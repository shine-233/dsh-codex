// dsh-codex-pack: aggregate manifest for the codex->dsh plugin kit.
// Each sibling repo now ships its own Cordis plugin; this bundle documents the
// assembly and reports which kit plugins the host actually loaded.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-codex-pack'
export const inject = ['tools']

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const KIT_PLUGINS = [
  'codex-policy-engine',
  'codex-edit-fusion',
  'codex-session-kit',
  'codex-net-guard',
  'codex-sandbox-bin',
  'codex-skills-kit',
  'codex-prompts',
  'codex-config-importer',
  'codex-schema',
  'dsh-codex-ledger',
  'dsh-codex-ui',
]

function manifest() {
  try { return JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) } catch { return {} }
}

export function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  try {
    if (ctx?.tools?.register) {
      const defineTool = (d) => d
      ctx.tools.register(defineTool({
        name: 'codex_kit_status',
        description: 'Report which codex->dsh kit plugins are installed in this host and what each contributes.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
        async execute() {
          const mods = globalThis.__dshCodexKitLoaded ?? []
          return JSON.stringify({ expected: KIT_PLUGINS, loadedMarkers: mods, manifest: manifest().modules ?? {}, mountPointsDoc: 'docs/MOUNT_POINTS.md', anchor: cfg.anchor ?? 'openai/codex@970b7f2ff4f6' }, null, 2)
        },
        timeoutMs: 3000,
      }))
    }
  } catch { /* tool seam unavailable */ }
}
