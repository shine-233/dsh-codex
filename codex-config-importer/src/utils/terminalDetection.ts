// Distilled from openai/codex terminal-detection (Apache-2.0, rust-v0.153.4):
// terminal/multiplexer identification from environment variables, plus a
// sanitized user-agent segment.
export type TerminalName =
  | 'AppleTerminal' | 'Ghostty' | 'Iterm2' | 'WarpTerminal' | 'VsCode' | 'WezTerm'
  | 'WindowsTerminal' | 'Alacritty' | 'Kitty' | 'Unknown'

export type Multiplexer =
  | { kind: 'Tmux'; version: string | null }
  | { kind: 'Zellij'; version: string | null }
  | { kind: 'Screen'; version: string | null }

export function detectTerminalName(env: NodeJS.ProcessEnv = process.env): TerminalName {
  const program = env.TERM_PROGRAM ?? ''
  if (env.TERM_PROGRAM === 'Apple_Terminal') return 'AppleTerminal'
  if (program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR) return 'Ghostty'
  if (program === 'iTerm.app') return 'Iterm2'
  if (env.WARP_TERMINAL || program === 'WarpTerminal') return 'WarpTerminal'
  if (program === 'vscode' || env.VSCODE_GIT_IPC_HANDLE) return 'VsCode'
  if (program === 'WezTerm') return 'WezTerm'
  if (env.WT_SESSION) return 'WindowsTerminal'
  if (env.ALACRITTY_LOG) return 'Alacritty'
  if (env.KITTY_WINDOW_ID) return 'Kitty'
  return 'Unknown'
}

export function detectMultiplexer(env: NodeJS.ProcessEnv = process.env): Multiplexer | null {
  if (env.TMUX) return { kind: 'Tmux', version: env.TERM_PROGRAM_VERSION ?? null }
  if (env.ZELLIJ_VERSION) return { kind: 'Zellij', version: env.ZELLIJ_VERSION }
  if (env.STY) return { kind: 'Screen', version: null }
  return null
}

/** Sanitized terminal identifier for User-Agent strings. */
export function userAgent(env: NodeJS.ProcessEnv = process.env): string {
  const name = detectTerminalName(env)
  const mux = detectMultiplexer(env)
  const parts = ['codex-config-importer', name]
  if (mux) parts.push(`${mux.kind.toLowerCase()}${mux.version ? '/' + mux.version : ''}`)
  return parts.join(' ')
}
