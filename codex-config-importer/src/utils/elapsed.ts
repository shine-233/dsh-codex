// Port of openai/codex utils/elapsed (Apache-2.0, rust-v0.153.4).
/** "250ms" / "2.50s" / "1m 05s" — matches upstream format_duration_millis. */
export function formatElapsedMillis(millis: number): string {
  if (millis < 1000) return `${millis}ms`
  if (millis < 60_000) return `${(millis / 1000).toFixed(2)}s`
  const minutes = Math.floor(millis / 60_000)
  const seconds = Math.floor((millis % 60_000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function formatDuration(durationMs: number): string {
  return formatElapsedMillis(Math.trunc(durationMs))
}
