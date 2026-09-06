// Port of openai/codex utils/output-truncation + utils/string truncate helpers
// (Apache-2.0), at upstream anchor rust-v0.153.4 — including the 0.153.4
// empty-text-item skip. Byte/token approximation is the upstream 4 bytes/token
// heuristic (approx_bytes_per_token).
export const APPROX_BYTES_PER_TOKEN = 4

export type TruncationPolicy =
  | { kind: 'bytes'; budget: number }
  | { kind: 'tokens'; budget: number }

export function approxTokenCount(text: string): number {
  const len = Buffer.byteLength(text, 'utf8')
  return Math.floor((len + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN)
}

export function approxBytesForTokens(tokens: number): number {
  return tokens * APPROX_BYTES_PER_TOKEN
}

export function approxTokensFromByteCount(bytes: number): number {
  if (bytes <= 0) return 0
  return Math.floor((bytes + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN)
}

export function truncateMiddleChars(s: string, maxBytes: number): string {
  return truncateWithByteEstimate(s, maxBytes, false)
}

export function truncateMiddleWithTokenBudget(s: string, maxTokens: number): [string, number | null] {
  if (!s) return ['', null]
  if (maxTokens > 0 && Buffer.byteLength(s, 'utf8') <= approxBytesForTokens(maxTokens)) return [s, null]
  const truncated = truncateWithByteEstimate(s, approxBytesForTokens(maxTokens), true)
  const totalTokens = approxTokenCount(s)
  return truncated === s ? [truncated, null] : [truncated, totalTokens]
}

function truncateWithByteEstimate(s: string, maxBytes: number, useTokens: boolean): string {
  if (!s) return ''
  if (maxBytes === 0) return formatMarker(useTokens, removedUnits(useTokens, Buffer.byteLength(s, 'utf8'), [...s].length))
  const totalBytes = Buffer.byteLength(s, 'utf8')
  if (totalBytes <= maxBytes) return s

  const leftBudget = Math.floor(maxBytes / 2)
  const rightBudget = maxBytes - leftBudget

  // Byte-oriented split that respects UTF-8 boundaries via code points.
  const chars = [...s]
  const removedCharsSet = new Set<number>()
  let byteCursor = 0
  let prefixEndIdx = 0
  let suffixStartIdx = 0
  const charStarts: number[] = []
  for (let i = 0; i < chars.length; i++) { charStarts.push(byteCursor); byteCursor += Buffer.byteLength(chars[i], 'utf8') }
  const totalEnd = byteCursor
  const tailStartTarget = Math.max(0, totalBytes - rightBudget)
  for (let i = 0; i < chars.length; i++) {
    const charEnd = charStarts[i] + Buffer.byteLength(chars[i], 'utf8')
    if (charEnd <= leftBudget) { prefixEndIdx = i + 1; continue }
    if (charStarts[i] >= tailStartTarget) { suffixStartIdx = i; break }
    removedCharsSet.add(i)
  }
  if (suffixStartIdx < prefixEndIdx) suffixStartIdx = prefixEndIdx
  const removedChars = removedCharsSet.size
  const removedBytes = Math.max(0, totalEnd - maxBytes)
  const marker = formatMarker(useTokens, removedUnits(useTokens, removedBytes, removedChars))
  return chars.slice(0, prefixEndIdx).join('') + marker + chars.slice(suffixStartIdx).join('')
}

function formatMarker(useTokens: boolean, removedCount: number): string {
  return useTokens ? `…${removedCount} tokens truncated…` : `…${removedCount} chars truncated…`
}

function removedUnits(useTokens: boolean, removedBytes: number, removedChars: number): number {
  return useTokens ? approxTokensFromByteCount(removedBytes) : removedChars
}

export function formattedTruncateText(content: string, policy: TruncationPolicy): string {
  // Upstream compares against policy.byte_budget(): for a token policy that is
  // approx_bytes_for_tokens(budget), not the raw token count.
  const budgetBytes = policy.kind === 'bytes' ? policy.budget : approxBytesForTokens(policy.budget)
  if (Buffer.byteLength(content, 'utf8') <= budgetBytes) return content
  const originalTokenCount = approxTokenCount(content)
  const totalLines = content.split('\n').length
  const result = truncateText(content, policy)
  return `Warning: truncated output (original token count: ${originalTokenCount})\nTotal output lines: ${totalLines}\n\n${result}`
}

export function truncateText(content: string, policy: TruncationPolicy): string {
  return policy.kind === 'bytes'
    ? truncateMiddleChars(content, policy.budget)
    : truncateMiddleWithTokenBudget(content, policy.budget)[0]
}

// ── function-call output items ───────────────────────────────────────────────

export type OutputContentItem =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; imageUrl: string; detail?: string }
  | { type: 'input_audio'; audioUrl: string }
  | { type: 'encrypted_content'; encryptedContent: string }

/**
 * Budget-truncate content items. Port of upstream
 * truncate_function_output_items_with_policy including the rust-v0.153.4
 * empty-text-item skip.
 */
export function truncateFunctionOutputItems(
  items: OutputContentItem[],
  policy: TruncationPolicy,
  estimateAudioTokenCount: (audioUrl: string) => number = () => 0,
): OutputContentItem[] {
  const out: OutputContentItem[] = []
  let remainingBudget = policy.budget
  let omittedTextItems = 0
  let omittedAudioItems = 0

  for (const item of items) {
    if (item.type === 'input_text') {
      // Empty text contributes no model content but still consumes an API array slot.
      if (item.text === '') continue
      if (remainingBudget === 0) { omittedTextItems++; continue }
      const cost = policy.kind === 'bytes'
        ? Buffer.byteLength(item.text, 'utf8')
        : approxTokenCount(item.text)
      if (cost <= remainingBudget) {
        out.push(item)
        remainingBudget -= cost
      } else {
        const snippet = truncateText(item.text, { kind: policy.kind, budget: remainingBudget })
        if (snippet === '') omittedTextItems++
        else out.push({ type: 'input_text', text: snippet })
        remainingBudget = 0
      }
      continue
    }
    if (item.type === 'input_image') { out.push(item); continue }
    if (item.type === 'input_audio') {
      const tokenCost = estimateAudioTokenCount(item.audioUrl)
      const cost = policy.kind === 'bytes' ? approxBytesForTokens(tokenCost) : tokenCost
      if (cost <= remainingBudget) { out.push(item); remainingBudget -= cost }
      else omittedAudioItems++
      continue
    }
    out.push(item)
  }

  if (omittedTextItems > 0) out.push({ type: 'input_text', text: `[omitted ${omittedTextItems} text items ...]` })
  if (omittedAudioItems > 0) out.push({ type: 'input_text', text: `[omitted ${omittedAudioItems} audio items ...]` })
  return out
}
