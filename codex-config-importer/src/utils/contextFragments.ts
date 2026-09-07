// Distilled from openai/codex context-fragments (Apache-2.0, rust-v0.153.4):
// additional context fragments injected into prompts — annotated content
// blocks that carry a source tag so downstream pruning can attribute them.
export type FragmentKind = 'additional_context' | 'annotated_content'

export interface ContextFragment {
  kind: FragmentKind
  /** stable key used for dedupe/merge */
  key: string
  /** which stage produced the fragment (e.g. file, tool, user) */
  source: string
  text: string
  annotations?: Record<string, string>
}

export function fragment(f: Omit<ContextFragment, 'kind'> & { kind?: FragmentKind }): ContextFragment {
  return { kind: 'additional_context', ...f }
}

/** Merge fragments by key; later fragments win, sources concatenate. */
export function mergeFragments(fragments: ContextFragment[]): ContextFragment[] {
  const byKey = new Map<string, ContextFragment>()
  for (const f of fragments) {
    const existing = byKey.get(f.key)
    if (!existing) { byKey.set(f.key, { ...f }); continue }
    byKey.set(f.key, { ...existing, text: existing.text === f.text ? existing.text : `${existing.text}\n${f.text}` })
  }
  return [...byKey.values()]
}
