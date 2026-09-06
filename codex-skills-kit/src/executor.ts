// Skill resource executor, distilled from openai/codex ext/skills tools/read.rs
// (Apache-2.0, anchor rust-v0.153.4): authority-guarded resource reads with a
// content byte cap and pagination cursors. The upstream tool keeps read
// handles across calls; this distillation re-opens per call (stateless face
// for dsh's stateless tool seam) while keeping the same guarantees:
// reads resolve ONLY inside the skill root (authority), content over
// MAX_SKILL_RESOURCE_CONTENT_BYTES is rejected, and large resources page via
// a byte-offset cursor.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export const MAX_SKILL_RESOURCE_CONTENT_BYTES = 262144 // 256 KiB, upstream provider cap

export interface SkillReadArgs { package: string; resource?: string; offset?: number }
export interface SkillReadResponse { resource: string; contents: string; skillRoot: string; nextOffset: number | null }

function skillRootFor(skillsRoot: string, pkg: string): string | null {
  const root = resolve(join(skillsRoot, pkg))
  // Authority: the resolved package dir must stay inside the skills root.
  if (!root.startsWith(resolve(skillsRoot) + sep)) return null
  if (!existsSync(root)) return null
  return root
}

/** List the skill packages available under a skills root. */
export function skillList(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

/**
 * Read SKILL.md (resource omitted) or a resource file of a skill package.
 * Rejects path escapes, missing files, and over-cap content; pages large
 * resources by byte offset.
 */
export function skillRead(skillsRoot: string, args: SkillReadArgs): SkillReadResponse {
  const root = skillRootFor(skillsRoot, args.package)
  if (!root) throw new Error(`skill package not found under skills root: ${args.package}`)
  const rel = args.resource && args.resource !== '' ? args.resource : 'SKILL.md'
  const file = resolve(root, rel)
  // Authority: resolved file must stay inside the package dir.
  if (!file.startsWith(root + sep)) throw new Error(`resource escapes skill package: ${rel}`)
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`resource not found: ${rel}`)

  const size = statSync(file).size
  if (size > MAX_SKILL_RESOURCE_CONTENT_BYTES && args.resource === undefined) {
    throw new Error(`SKILL.md exceeds ${MAX_SKILL_RESOURCE_CONTENT_BYTES} bytes; read a resource instead`)
  }

  const offset = Math.max(0, args.offset ?? 0)
  const buf = readFileSync(file)
  const slice = buf.subarray(offset, offset + MAX_SKILL_RESOURCE_CONTENT_BYTES)
  const nextOffset = offset + slice.length < size ? offset + slice.length : null
  return {
    resource: rel,
    contents: slice.toString('utf8'),
    skillRoot: root,
    nextOffset,
  }
}
