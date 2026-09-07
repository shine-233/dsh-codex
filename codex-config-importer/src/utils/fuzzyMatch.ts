// Port of openai/codex utils/fuzzy-match (Apache-2.0, rust-v0.153.4):
// case-insensitive greedy subsequence match. Returns the matched original
// character indices and a bonus score (i32::MAX for an empty needle).
export function fuzzyMatch(haystack: string, needle: string): { indices: number[]; score: number } | null {
  if (needle === '') return { indices: [], score: Number.MAX_SAFE_INTEGER }

  const loweredChars: string[] = []
  const loweredToOrig: number[] = []
  for (const [origIdx, ch] of [...haystack].entries()) {
    for (const lc of ch.toLowerCase()) {
      loweredChars.push(lc)
      loweredToOrig.push(origIdx)
    }
  }
  const loweredNeedle = [...needle.toLowerCase()]

  const resultOrig: number[] = []
  let lastLowerPos: number | null = null
  let contiguousRun = 0
  let score = 0
  let cur = 0
  for (const nc of loweredNeedle) {
    let foundAt: number | null = null
    while (cur < loweredChars.length) {
      if (loweredChars[cur] === nc) { foundAt = cur; cur++; break }
      cur++
    }
    if (foundAt === null) return null
    const origIdx = loweredToOrig[foundAt]
    resultOrig.push(origIdx)
    // Scoring: reward contiguity and word starts (mirrors upstream bonuses).
    if (lastLowerPos !== null && foundAt === lastLowerPos + 1) { contiguousRun++; score += 2 } else contiguousRun = 0
    if (foundAt === 0 || /[\s\-_./\\]/.test(haystack[origIdx - 1] ?? ' ')) score += 1
    lastLowerPos = foundAt
  }
  return { indices: resultOrig, score }
}
