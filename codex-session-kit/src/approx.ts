// Shared 4-bytes/token approximation (upstream codex-utils-string).
export const APPROX_BYTES_PER_TOKEN = 4

export function approxTokensFromByteCount(bytes: number): number {
  if (bytes <= 0) return 0
  return Math.floor((bytes + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN)
}
