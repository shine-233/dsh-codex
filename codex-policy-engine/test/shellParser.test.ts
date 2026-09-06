import { describe, it, expect } from 'vitest';
import { parseShellLine, shellSubCommands } from '../src/shellParser';
import { dangerousCommandMatchLine } from '../src/commandSafety';

describe('shellParser (semantic line parsing, distilled from parse_command.rs)', () => {
  it('splits piped and sequenced invocations', () => {
    const p = parseShellLine('git status && npm test; curl example.com | wc -l');
    expect(p.invocations.map((i) => i.argv[0])).toEqual(['git', 'npm', 'curl', 'wc']);
  });
  it('captures command substitutions and their inner commands', () => {
    const p = parseShellLine('echo $(rm -rf /) then `cat /etc/passwd`');
    expect(p.substitutions).toEqual(['rm -rf /', 'cat /etc/passwd']);
    expect(shellSubCommands('echo $(rm -rf /)')).toContain('rm -rf /');
  });
  it('captures heredoc bodies', () => {
    const p = parseShellLine('cat << EOF\nrm -rf /\nEOF');
    expect(p.heredocs).toHaveLength(1);
    expect(p.heredocs[0].body).toBe('rm -rf /');
  });
  it('keeps quoted operators as literals', () => {
    const p = parseShellLine('echo "a && b"');
    expect(p.invocations).toHaveLength(1);
    expect(p.invocations[0].argv.join(' ')).toBe('echo a && b');
  });
  it('records comments separately', () => {
    const p = parseShellLine('git status # note');
    expect(p.invocations[0].argv[0]).toBe('git');
    expect(p.comments).toEqual(['note']);
  });
});

describe('dangerousCommandMatchLine (semantic classifier)', () => {
  it('sees through command substitution evasion', () => {
    expect(dangerousCommandMatchLine('echo $(rm -rf /)', { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatchLine('echo `rm -rf /`', { platform: 'posix' })).toBe('ForcedRm');
    // a naive tokenizer sees only `echo` here
    expect(dangerousCommandMatchLine('echo rm -rf /', { platform: 'posix' })).toBeNull();
  });
  it('classifies heredoc bodies', () => {
    expect(dangerousCommandMatchLine('cat << EOF\nrm -rf /\nEOF', { platform: 'posix' })).toBe('ForcedRm');
  });
  it('flags the real invocation, not just the first word', () => {
    expect(dangerousCommandMatchLine('git status && sudo rm -rf /', { platform: 'posix' })).toBe('ForcedRm');
    expect(dangerousCommandMatchLine('git status', { platform: 'posix' })).toBeNull();
  });
});
