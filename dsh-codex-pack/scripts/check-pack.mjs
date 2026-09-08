import { validatePackLayout } from '../lib/index.js'
const result = validatePackLayout(process.cwd())
if (!result.ok) {
  console.error('[FAIL] dsh-codex-pack preflight')
  for (const error of result.errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`[OK] dsh-codex-pack preflight (${result.modules.length} sibling modules)`)
