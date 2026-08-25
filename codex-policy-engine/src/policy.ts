// Port of execpolicy/src/policy.rs core (Apache-2.0): rules_by_program multimap,
// overlay merge, heuristics fallback, safest-first aggregation.
import { aggregate, type Decision, type Evaluation } from './decision.js';
import { ruleMatches, type PrefixRule } from './rule.js';

export class Policy {
  private rulesByProgram = new Map<string, PrefixRule[]>();
  private networkAllowed = new Set<string>();
  private networkDenied = new Set<string>();

  addPrefixRule(rule: PrefixRule): void {
    const list = this.rulesByProgram.get(rule.first) ?? [];
    list.push(rule);
    this.rulesByProgram.set(rule.first, list);
  }

  allowNetwork(host: string): void { this.networkAllowed.add(host); this.networkDenied.delete(host); }
  denyNetwork(host: string): void { this.networkDenied.add(host); this.networkAllowed.delete(host); }

  allowedDomains(): string[] { return [...this.networkAllowed]; }
  deniedDomains(): string[] { return [...this.networkDenied]; }

  mergeOverlay(overlay: Policy): Policy {
    const out = new Policy();
    for (const [prog, rules] of this.rulesByProgram) out.rulesByProgram.set(prog, [...rules]);
    for (const [prog, rules] of overlay.rulesByProgram) {
      out.rulesByProgram.set(prog, [...(out.rulesByProgram.get(prog) ?? []), ...rules]);
    }
    out.networkAllowed = new Set([...this.networkAllowed, ...overlay.networkAllowed]);
    out.networkDenied = new Set([...this.networkDenied, ...overlay.networkDenied]);
    return out;
  }

  /** Matches rules for cmd; if none match, falls back to the caller heuristic. */
  check(cmd: string[], heuristic: (c: string[]) => Decision = () => 'Prompt'): Evaluation {
    const rules = this.rulesByProgram.get(cmd[0]) ?? [];
    const matched = rules.filter((r) => ruleMatches(r, cmd));
    if (matched.length === 0) {
      return { decision: heuristic(cmd), matchedPrograms: [] };
    }
    return {
      decision: aggregate(matched.map((r) => r.decision)),
      matchedPrograms: matched.map((r) => r.first),
    };
  }
}
