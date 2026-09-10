import { describe, expect, it } from 'vitest'
import fixture from './powershell_lowering.json'
import {
  extractPowershellCommand,
  parsePowershellScriptIntoPlainCommands,
} from '../src/powershellLowering'
import { dangerousCommandMatch } from '../src/commandSafety'

interface LoweringCase {
  name: string
  script: string
  expected: string[][] | null
}

describe('PowerShell literal lowering parity', () => {
  it.each(fixture as LoweringCase[])('$name', ({ script, expected }) => {
    expect(parsePowershellScriptIntoPlainCommands(script)).toEqual(expected)
  })

  it('feeds every lowered pipeline command to Windows danger policy', () => {
    expect(dangerousCommandMatch([
      'pwsh',
      '-NoProfile',
      '-Command',
      "Write-Output safe | Start-Process 'https://example.invalid/x'",
    ], { platform: 'windows' })).toBe('Other')
    expect(dangerousCommandMatch([
      'pwsh',
      '-Command',
      'Write-Output C:\\tmp\\x',
    ], { platform: 'windows' })).toBeNull()
  })

  it('extracts known wrapper flags and rejects unknown options', () => {
    expect(extractPowershellCommand([
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      '-NoLogo',
      '-NoProfile',
      '-c',
      'Get-Content Cargo.toml',
    ])).toEqual({
      shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      script: 'Get-Content Cargo.toml',
    })
    expect(extractPowershellCommand([
      'pwsh',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-Content Cargo.toml',
    ])).toBeNull()
  })
})
