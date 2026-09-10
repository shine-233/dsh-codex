// Derived from openai/codex protocol/src/sanitized_git_url.rs (Apache-2.0).
// Git rollout metadata is untrusted persisted input: remove authority credentials
// without decoding or normalizing the repository path.

const INVALID_GIT_REMOTE_URL = 'invalid git remote URL'
const HELPER_TRANSPORT = /^[A-Za-z0-9+.-]+$/

export class InvalidGitRemoteUrlError extends Error {
  constructor() {
    super(INVALID_GIT_REMOTE_URL)
    this.name = 'InvalidGitRemoteUrlError'
  }
}

function invalid(): never {
  throw new InvalidGitRemoteUrlError()
}

function splitRemoteHelpers(value: string): { prefix: string; address: string } {
  let offset = 0
  while (true) {
    const separator = value.indexOf('::', offset)
    if (separator < 0) break
    const transport = value.slice(offset, separator)
    if (!transport || !HELPER_TRANSPORT.test(transport)) break
    offset = separator + 2
  }
  const address = value.slice(offset)
  if (offset > 0 && /\s/.test(address)) invalid()
  return { prefix: value.slice(0, offset), address }
}

function sanitizeStandardUrl(prefix: string, address: string): string | undefined {
  const schemeEnd = address.indexOf('://')
  if (schemeEnd < 1) return undefined
  const scheme = address.slice(0, schemeEnd)
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) invalid()

  const authorityStart = schemeEnd + 3
  const pathStart = address.indexOf('/', authorityStart)
  const authorityEnd = pathStart < 0 ? address.length : pathStart
  const authority = address.slice(authorityStart, authorityEnd)
  if (!authority || /\s/.test(authority)) invalid()
  const at = authority.lastIndexOf('@')
  if (at < 0) return `${prefix}${address}`

  const userInfo = authority.slice(0, at)
  const host = authority.slice(at + 1)
  if (!host || host.includes('@') || /[\[\]]/.test(host) && !/^\[[^\]]+\](?::\d+)?$/.test(host)) invalid()
  const username = userInfo.split(':', 1)[0]
  const preserveGit = scheme.toLowerCase() === 'ssh' && username === 'git'
  const retainedUser = preserveGit ? 'git@' : ''
  return `${prefix}${scheme}://${retainedUser}${host}${address.slice(authorityEnd)}`
}

function sanitizeScpRemote(prefix: string, address: string): string {
  if (!address || /^\s|\s$/.test(address)) invalid()

  const at = address.indexOf('@')
  if (at >= 0) {
    const username = address.slice(0, at)
    const hostAndPath = address.slice(at + 1)
    if (!username || !hostAndPath) invalid()
    const separator = hostAndPath.startsWith('[')
      ? hostAndPath.indexOf(']:') + 1
      : hostAndPath.indexOf(':')
    if (separator <= 0 || !hostAndPath.slice(separator + 1)) invalid()
    return `${prefix}${username === 'git' ? 'git@' : ''}${hostAndPath}`
  }

  const separator = address.startsWith('[')
    ? address.indexOf(']:') + 1
    : address.indexOf(':')
  if (separator <= 0 || !address.slice(separator + 1)) invalid()
  return `${prefix}${address}`
}

/** Remove credentials from URL and SCP-style Git remotes, preserving path bytes. */
export function sanitizeGitRemoteUrl(value: string): string {
  const { prefix, address } = splitRemoteHelpers(value)
  return sanitizeStandardUrl(prefix, address) ?? sanitizeScpRemote(prefix, address)
}

/** Tolerant persisted-metadata form: malformed legacy remotes become absent. */
export function sanitizeOptionalGitRemoteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return sanitizeGitRemoteUrl(value)
  } catch {
    return undefined
  }
}
