import { describe, it, expect } from 'vitest';
import {
  dangerousCommandMatch,
  executableNameLookupKey,
  executableBasename,
  isDangerousPowershellWords,
  shlexSplit,
  detectEscalation,
} from '../src/commandSafety';

describe('commandSafety (ported from shell-command command_safety, rust-v0.153.4)', () => {
  it('flags rm with force as ForcedRm', () => {
    expect(dangerousCommandMatch(['rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['rm', '-fr', 'build'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['rm', '--force', 'x'], { platform: 'posix' })).toBe('ForcedRm');
  });
  it('does not flag plain rm', () => {
    expect(dangerousCommandMatch(['rm', 'file.txt'], { platform: 'posix' })).toBeNull();
    expect(dangerousCommandMatch(['rm', '-r', 'dir'], { platform: 'posix' })).toBeNull();
  });
  it('sees through sudo and env wrappers', () => {
    expect(dangerousCommandMatch(['sudo', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['env', 'VAR=1', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['env', '-i', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
  });
  it('routes privilege-escalation wrappers (shell_detect escalation routing)', () => {
    // posix: doas / pkexec / su -c, including when the escalator carries its own flags
    expect(dangerousCommandMatch(['doas', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['pkexec', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['sudo', '-u', 'root', 'rm', '-rf', '/'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['su', '-c', 'rm -rf /'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['su', '-c', 'echo safe'], { platform: 'posix' })).toBeNull();
    expect(dangerousCommandMatch(['doas', 'rm', 'file'], { platform: 'posix' })).toBeNull();
    // windows: runas / gsudo / elevate, with their own option flags stripped
    expect(dangerousCommandMatch(['runas', '/user:Administrator', 'cmd', '/c', 'del', '/f', 'C:\\x'], { platform: 'windows' })).toBe('Other');
    expect(dangerousCommandMatch(['gsudo', 'rm', '-rf', '/'], { platform: 'windows' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['elevate', 'cmd', '/c', 'del', '/f', 'C:\\x'], { platform: 'windows' })).toBe('Other');
    expect(dangerousCommandMatch(['runas', '/user:Admin', 'notepad'], { platform: 'windows' })).toBeNull();
  });
  it('detectEscalation reports inner command with the escalator flags stripped', () => {
    expect(detectEscalation(['sudo', '-u', 'root', 'rm', '-rf', '/'], 'posix')).toEqual({
      escalator: 'sudo',
      rest: ['rm', '-rf', '/'],
    });
    expect(detectEscalation(['runas', '/user:Admin', 'cmd', '/c', 'del', '/f', 'x'], 'windows')).toEqual({
      escalator: 'runas',
      rest: ['cmd', '/c', 'del', '/f', 'x'],
    });
    expect(detectEscalation(['su', '-c', 'rm -rf /'], 'posix')).toEqual({
      escalator: 'su',
      rest: ['sh', '-c', 'rm -rf /'],
    });
    expect(detectEscalation(['rm', '-rf', '/'], 'posix')).toBeNull();
  });
  it('sees through sh -c literal scripts', () => {
    expect(dangerousCommandMatch(['sh', '-c', 'rm -rf /'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['bash', '-c', 'echo hi && rm -rf /'], { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatch(['sh', '-c', 'echo safe'], { platform: 'posix' })).toBeNull();
  });
  it('bails on excessive wrapper depth', () => {
    let script = 'echo hi';
    for (let i = 0; i < 12; i++) script = `sh -c ${JSON.stringify(script)}`;
    expect(dangerousCommandMatch(['sh', '-c', script], { platform: 'posix' })).toBe('Other');
  });
  it('executable lookup key strips drive letters and exe suffixes (0.153.4 fix)', () => {
    expect(executableNameLookupKey('C:\\evil\\tools\\powershell.exe', 'windows')).toBe('powershell');
    expect(executableNameLookupKey('C:\\Windows\\System32\\cmd.exe', 'windows')).toBe('cmd');
    expect(executableNameLookupKey('/usr/bin/rm', 'posix')).toBe('rm');
  });
  it('executableBasename keeps extension and handles drive letters', () => {
    expect(executableBasename('C:\\evil\\powershell.exe')).toBe('powershell.exe');
    expect(executableBasename('/usr/local/bin/tool')).toBe('tool');
  });
  it('windows: powershell Start-Process with URL is dangerous', () => {
    expect(dangerousCommandMatch(
      ['powershell', '-Command', "Start-Process 'https://example.invalid/x'"],
      { platform: 'windows' },
    )).toBe('Other');
    expect(dangerousCommandMatch(
      ['powershell', '-Command', 'Start-Process notepad'],
      { platform: 'windows' },
    )).toBeNull();
  });
  it('windows: powershell Remove-Item -Force is dangerous', () => {
    expect(isDangerousPowershellWords(['Remove-Item', '-Force', 'file'])).toBe(true);
    expect(isDangerousPowershellWords(['Remove-Item', 'file'])).toBe(false);
    expect(isDangerousPowershellWords(['ri', '-Force', 'file'])).toBe(true);
  });
  it('windows: cmd /c del /f and start URL are dangerous', () => {
    expect(dangerousCommandMatch(['cmd', '/c', 'del', '/f', 'file'], { platform: 'windows' })).toBe('Other');
    expect(dangerousCommandMatch(['cmd', '/c', 'start', 'https://example.invalid'], { platform: 'windows' })).toBe('Other');
    expect(dangerousCommandMatch(['cmd', '/c', 'echo', 'hi'], { platform: 'windows' })).toBeNull();
  });
  it('windows: direct GUI launch with URL is dangerous', () => {
    expect(dangerousCommandMatch(['explorer', 'https://example.invalid'], { platform: 'windows' })).toBe('Other');
    expect(dangerousCommandMatch(['explorer', 'C:\\dir'], { platform: 'windows' })).toBeNull();
    expect(dangerousCommandMatch(['mshta', 'https://example.invalid/x.hta'], { platform: 'windows' })).toBe('Other');
    expect(dangerousCommandMatch(
      ['rundll32', 'url.dll,FileProtocolHandler', 'https://example.invalid'],
      { platform: 'windows' },
    )).toBe('Other');
  });
  it('windows: forced rm via windows path still reports ForcedRm', () => {
    expect(dangerousCommandMatch(['rm', '-rf', '/'], { platform: 'windows' })).toBe('ForcedRm');
  });
  it('shlexSplit is quote aware', () => {
    expect(shlexSplit('sh -c "rm -rf /"')).toEqual(['sh', '-c', 'rm -rf /']);
    expect(shlexSplit("echo 'it''s'")).not.toBeNull();
  });
});
