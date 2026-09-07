// Port of openai/codex shell-command/src/powershell.rs extract_powershell_command
// (Apache-2.0, anchor rust-v0.153.4): recognize a top-level PowerShell wrapper
// (pwsh/powershell[.exe]) and pull out the raw -Command/-c script body.
import { detectShellType } from './shellDetect.js'

const POWERSHELL_FLAGS = ['-nologo', '-noprofile', '-command', '-c']

/** Returns [shell, script] or null. Mirrors upstream exactly. */
export function extractPowershellCommand(command: string[]): [string, string] | null {
  if (command.length < 3) return null
  const shell = command[0]
  if (detectShellType(shell) !== 'powershell') return null
  // Find the first occurrence of -Command (accept the -c alias); reject unknown flags.
  let i = 1
  while (i + 1 < command.length) {
    const flag = command[i]
    if (!POWERSHELL_FLAGS.includes(flag.toLowerCase())) return null
    if (flag.toLowerCase() === '-command' || flag.toLowerCase() === '-c') {
      const script = command[i + 1]
      return [shell, script]
    }
    i += 1
  }
  return null
}
