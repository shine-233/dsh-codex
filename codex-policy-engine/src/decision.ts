// Port of execpolicy/src/decision.rs semantics (Apache-2.0).
// Aggregation is safest-first: Forbidden beats Prompt beats Allow.
export type Decision = 'Allow' | 'Forbidden' | 'Prompt';

const RANK: Record<Decision, number> = { Allow: 0, Prompt: 1, Forbidden: 2 };

export function maxDecision(a: Decision, b: Decision): Decision {
  return RANK[a] >= RANK[b] ? a : b;
}

export interface Evaluation {
  decision: Decision;
  matchedPrograms: string[];
}

export function aggregate(decisions: Decision[]): Evaluation['decision'] {
  if (decisions.length === 0) return 'Prompt';
  return decisions.reduce(maxDecision);
}
