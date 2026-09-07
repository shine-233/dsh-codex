// Port of openai/codex shell-command/src/shell_detect.rs detect_shell_type
// (Apache-2.0, anchor rust-v0.153.4): exact-name match then file-stem
// recursion. Only the classification the parser needs is ported.

export type ShellType = 'zsh' | 'sh' | 'cmd' | 'bash' | 'powershell'

/** Port of std::path::Path::file_stem for the shell-path cases (both / and \). */
function fileStem(path: string): string | null {
  const base = path.split(/[\\/]/).pop() ?? ''
  if (base === '') return null
  const dot = base.lastIndexOf('.')
  // Rust: a leading dot is not an extension separator ("." and ".." and
  // ".hidden" have no extension); require a non-empty stem.
  if (dot > 0) return base.slice(0, dot)
  return base
}

export function detectShellType(shellPath: string): ShellType | null {
  if (shellPath === 'zsh') return 'zsh'
  if (shellPath === 'sh') return 'sh'
  if (shellPath === 'cmd') return 'cmd'
  if (shellPath === 'bash') return 'bash'
  if (shellPath === 'pwsh') return 'powershell'
  if (shellPath === 'powershell') return 'powershell'
  const stem = fileStem(shellPath)
  if (stem !== null && stem !== shellPath) return detectShellType(stem)
  return null
}

export type ShellKind = 'bash' | 'zsh' | 'sh' | 'powershell' | 'cmd'

/** Classify a shell path into the kinds parse_command cares about, or null. */
export function classifyShell(shellPath: string): ShellKind | null {
  const t = detectShellType(shellPath)
  return t === null || t === 'cmd' ? null : (t as ShellKind)
}
