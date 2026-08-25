// Prefix rule model from execpolicy/src/rule.rs + policy.rs add_prefix_rule (Apache-2.0).
export type PatternToken =
  | { kind: 'Single'; value: string }
  | { kind: 'Alts'; values: string[] };

export function singleToken(value: string): PatternToken {
  return { kind: 'Single', value };
}
export function altsToken(values: string[]): PatternToken {
  return { kind: 'Alts', values };
}
export interface PrefixRule {
  first: string;
  rest: PatternToken[];
  decision: import('./decision.js').Decision;
}

export function prefixRule(first: string, rest: string[], decision: import('./decision.js').Decision): PrefixRule {
  return { first, rest: rest.map(singleToken), decision };
}

function tokenMatches(t: PatternToken, arg: string): boolean {
  switch (t.kind) {
    case 'Single': return t.value === arg;
    case 'Alts': return t.values.includes(arg);
  }
}

export function ruleMatches(rule: PrefixRule, cmd: string[]): boolean {
  if (cmd[0] !== rule.first) return false;
  if (cmd.length - 1 < rule.rest.length) return false;
  for (let i = 0; i < rule.rest.length; i++) {
    if (!tokenMatches(rule.rest[i], cmd[i + 1])) return false;
  }
  return true;
}
