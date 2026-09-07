// Port of openai/codex utils/home-dir (Apache-2.0, rust-v0.153.4):
// CODEX_HOME override with existence/dir validation, then ~/.codex.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export function findCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEX_HOME?.trim()
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`CODEX_HOME points to ${JSON.stringify(override)}, but that path does not exist`)
    }
    if (!statSync(override).isDirectory()) {
      throw new Error(`CODEX_HOME points to ${JSON.stringify(override)}, but that path is not a directory`)
    }
    return override
  }
  const home = env.USERPROFILE ?? homedir()
  return join(home, '.codex')
}
