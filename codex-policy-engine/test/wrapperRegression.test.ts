import { describe, expect, it } from 'vitest'
import { dangerousCommandMatch, dangerousCommandMatchLine } from '../src/commandSafety.js'

// Regression guard for the wrapper-script bypass: a command line that reaches
// the classifier already tokenized presents the `-c` / `-Command` script body as
// several argv entries instead of one argument. Both entry points must agree.
//
// Known remaining gap (NOT covered here, see AUDIT-PLUGIN-PARITY-20260909.md):
// the PowerShell script body is still word-split with POSIX shlex, so a body
// containing a Windows path (`Remove-Item -Recurse -Force C:\`) fails to tokenize
// and is silently treated as safe. Fixing that needs a PowerShell-aware
// tokenizer; it is deliberately not claimed as fixed here.
describe('wrapper script bodies survive tokenization', () => {
  it('classifies sh -c when the script body is one argument', () => {
    expect(dangerousCommandMatch(['sh', '-c', 'rm -rf /'], { platform: 'posix' })).toBe('ForcedRm')
  })

  it('classifies sh -c when the script body is split across argv entries', () => {
    expect(dangerousCommandMatch(['sh', '-c', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm')
  })

  it('classifies sh -c on the line entry point', () => {
    expect(dangerousCommandMatchLine('sh -c "rm -rf /"', { platform: 'posix' })).toBe('ForcedRm')
    expect(dangerousCommandMatchLine('bash -c "rm -rf /"', { platform: 'posix' })).toBe('ForcedRm')
    expect(dangerousCommandMatchLine('zsh -c "rm -rf /"', { platform: 'posix' })).toBe('ForcedRm')
  })

  it('classifies powershell -Command on the line entry point', () => {
    const line = 'powershell -Command "Remove-Item test -Force"'
    expect(dangerousCommandMatchLine(line, { platform: 'windows' })).toBe('Other')
  })

  it('accepts the -c alias and leading powershell flags', () => {
    expect(dangerousCommandMatchLine('pwsh -c "Remove-Item -Force"', { platform: 'windows' })).toBe('Other')
    expect(dangerousCommandMatchLine('powershell -NoProfile -Command "Remove-Item -Force"', { platform: 'windows' })).toBe('Other')
  })

  it('still clears benign wrapped commands', () => {
    expect(dangerousCommandMatchLine('sh -c "echo hi"', { platform: 'posix' })).toBeNull()
    expect(dangerousCommandMatchLine('powershell -Command "Get-Content Cargo.toml"', { platform: 'windows' })).toBeNull()
  })
})
