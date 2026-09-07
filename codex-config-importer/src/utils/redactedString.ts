// Port of openai/codex utils/redacted-string (Apache-2.0, rust-v0.153.4):
// a transparent string wrapper whose Display/JSON form never leaks the value.
export class RedactedString {
  constructor(private inner: string) {}

  intoInner(): string { return this.inner }

  /** Upstream redacts to a fixed placeholder in every output form. */
  toString(): string { return 'REDACTED' }
  toJSON(): string { return 'REDACTED' }
  valueOf(): string { return this.inner }
}
