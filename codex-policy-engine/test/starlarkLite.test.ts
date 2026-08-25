import { describe, it, expect } from 'vitest';
import { parsePolicyFile } from '../src/index';

const SAMPLE = `
# execpolicy-style policy
prefix_rule("git", ["status", "diff"], ALLOW)
prefix_rule("npm", [["run", "exec"], ["test"]], PROMPT)
prefix_rule("rm", [], FORBIDDEN)
network_rule("evil.example.com", TCP, FORBIDDEN)
`;

describe('parsePolicyFile (starlark-lite)', () => {
  it('parses prefix rules with literals and alt-lists', () => {
    const p = parsePolicyFile(SAMPLE);
    expect(p.prefixRules.length).toBe(3);
    expect(p.prefixRules[0]).toEqual({ program:'git', args:[{kind:'Single',value:'status'},{kind:'Single',value:'diff'}], decision:'Allow' });
    expect(p.prefixRules[1].args[0]).toEqual({kind:'Alts',values:['run','exec']});
    expect(p.prefixRules[2].decision).toBe('Forbidden');
  });
  it('parses network rules', () => {
    const p = parsePolicyFile(SAMPLE);
    expect(p.networkRules[0]).toEqual({ host:'evil.example.com', protocol:'TCP', decision:'Forbidden' });
  });
});
