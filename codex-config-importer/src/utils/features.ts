// Distilled from openai/codex features crate (Apache-2.0, rust-v0.153.4):
// `[features]` config parsing — a feature entry is either a bare bool or a
// table with `enabled` plus an optional per-feature config payload. Unknown
// feature names are preserved (the importer reports them, the harness decides).
export type FeatureConfig = boolean | Record<string, unknown>

export interface Features {
  /** bare on/off flags */
  flags: Record<string, boolean>
  /** features with structured config payloads */
  configured: Record<string, Record<string, unknown>>
}

export function parseFeatures(raw: unknown): Features {
  const features: Features = { flags: {}, configured: {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return features
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') { features.flags[name] = value; continue }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const table = value as Record<string, unknown>
      const enabled = typeof table.enabled === 'boolean' ? table.enabled : true
      features.flags[name] = enabled
      const payload = { ...table }
      delete payload.enabled
      features.configured[name] = payload
      continue
    }
    features.flags[name] = Boolean(value)
  }
  return features
}

/** Is a named feature enabled? Unknown names default to false. */
export function isFeatureEnabled(features: Features, name: string): boolean {
  return features.flags[name] ?? false
}
