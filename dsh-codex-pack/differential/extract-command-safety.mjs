// Extracts test vectors from upstream openai/codex shell-command Rust tests
// into checked-in JSON, so the differential runner can replay them against the
// TS distillation without needing the Rust sources at test time.
//
// Usage: node extract-command-safety.mjs <codex-rs-src-dir> <out.json>
//
// Strategies (the two files assert differently):
//  - is_dangerous_command.rs: assert_eq! with the expected value AFTER the
//    vec_str array (Some(DangerousCommandMatch::ForcedRm|Other) / None) —
//    vectors pending since the previous marker attach to the next marker.
//  - windows_dangerous_commands.rs: assert!(...) / assert!(!...) WRAPS the
//    vec_str array — polarity comes from the nearest preceding assert!.
//
// Handled literals: normal strings with escapes, raw strings r"..." / r#"..."#.
// Dynamically built vectors are reported as skipped.

import { readFileSync, writeFileSync } from 'node:fs'

const srcDir = process.argv[2]
if (!srcDir) { console.error('usage: node extract-command-safety.mjs <codex-rs-src-dir> <out.json>'); process.exit(1) }
const outPath = process.argv[3]

/** Parse a Rust vec_str(&[...]) argv literal; {words, dynamic, end} or null. */
function parseVecStr(text, i) {
  const start = text.indexOf('&[', i)
  if (start === -1) return null
  let j = start + 2
  const words = []
  let dynamic = false
  while (j < text.length) {
    while (j < text.length && /[\s,]/.test(text[j])) j++
    if (text[j] === ']') { j++; break }
    if (text.startsWith('r#"', j)) {
      const close = text.indexOf('"#', j + 3)
      if (close === -1) return null
      words.push(text.slice(j + 3, close))
      j = close + 2
      continue
    }
    if (text.startsWith('r"', j)) {
      const close = text.indexOf('"', j + 2)
      if (close === -1) return null
      words.push(text.slice(j + 2, close))
      j = close + 1
      continue
    }
    if (text[j] === '"') {
      let s = ''
      j++
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          const e = text[j + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
          j += 2
        } else { s += text[j]; j++ }
      }
      j++
      words.push(s)
      continue
    }
    while (j < text.length && !/[,)\]]/.test(text[j])) j++
    dynamic = true
  }
  return { words, dynamic, end: j }
}

function extractFile(file, kind) {
  const text = readFileSync(file, 'utf8')
  const vectors = []
  let skippedDynamic = 0

  const blocks = [...text.matchAll(/fn ([a-z0-9_]+)\(\)\s*\{/g)]
  for (let b = 0; b < blocks.length; b++) {
    const name = blocks[b][1]
    const bodyStart = blocks[b].index + blocks[b][0].length
    const bodyEnd = b + 1 < blocks.length ? blocks[b + 1].index : text.length
    const body = text.slice(bodyStart, bodyEnd)

    if (kind === 'posix') {
      // marker-grouped: pending arrays attach to the next Some(...)/None marker
      const events = []
      let idx = 0
      while (true) {
        const at = body.indexOf('vec_str(&[', idx)
        if (at === -1) break
        const parsed = parseVecStr(body, at)
        idx = at + 10
        if (!parsed) continue
        if (parsed.dynamic) { skippedDynamic++; continue }
        events.push({ at, argv: parsed.words })
      }
      for (const m of body.matchAll(/Some\(DangerousCommandMatch::(ForcedRm|Other)\)|\bNone\b/g)) {
        events.push({ at: m.index, expected: m[1] ?? null })
      }
      events.sort((a, b2) => a.at - b2.at)
      let pending = []
      for (const ev of events) {
        if (ev.argv) { pending.push(ev); continue }
        // which upstream function does this assertion call?
        const before = body.slice(0, ev.at)
        const call = [...before.matchAll(/(dangerous_powershell_words_match|dangerous_command_match)\(/g)].pop()
        const callFn = call ? call[1] : 'dangerous_command_match'
        for (const p of pending) vectors.push({ fn: name, call: callFn, argv: p.argv, expected: ev.expected })
        pending = []
      }
      skippedDynamic += pending.length
      continue
    }

    // windows: assert wraps the array — polarity from the nearest preceding assert!
    let idx = 0
    while (true) {
      const at = body.indexOf('vec_str(&[', idx)
      if (at === -1) break
      idx = at + 10
      const parsed = parseVecStr(body, at)
      if (!parsed) continue
      if (parsed.dynamic) { skippedDynamic++; continue }
      const before = body.slice(0, at)
      const a = before.lastIndexOf('assert!')
      if (a === -1) continue
      const afterAssert = body.slice(a + 7, a + 12)
      const expected = /^\s*\(\s*!/.test(afterAssert) ? false : true
      vectors.push({ fn: name, argv: parsed.words, expected })
    }
  }
  return { file: file.split('/').pop(), kind, vectors, skippedDynamic }
}

const posix = extractFile(`${srcDir}/shell-command/src/command_safety/is_dangerous_command.rs`, 'posix')
const win = extractFile(`${srcDir}/shell-command/src/command_safety/windows_dangerous_commands.rs`, 'windows')

const out = {
  provenance: {
    source: 'openai/codex rust-v0.153.4 (042fb41b7c813ac7999105e886b2b7aa715b5081)',
    files: [posix.file, win.file],
    extractedAt: new Date().toISOString(),
    extractor: 'differential/extract-command-safety.mjs',
  },
  posix: posix.vectors,
  windows: win.vectors,
  skippedDynamic: posix.skippedDynamic + win.skippedDynamic,
}
writeFileSync(outPath, JSON.stringify(out, null, 1))
console.log(`posix vectors: ${posix.vectors.length} (skipped-dynamic: ${posix.skippedDynamic})`)
console.log(`windows vectors: ${win.vectors.length} (skipped-dynamic: ${win.skippedDynamic})`)
console.log(`written: ${outPath}`)
