import { describe, expect, it } from 'vitest'
import {
  InvalidGitRemoteUrlError,
  sanitizeGitRemoteUrl,
  sanitizeOptionalGitRemoteUrl,
} from '../src/sanitizedGitUrl'
import { parseRolloutText } from '../src/index'

describe('sanitizeGitRemoteUrl', () => {
  it.each([
    ['https://alice:secret@github.com/org/repo.git', 'https://github.com/org/repo.git'],
    ['https://secret-token@github.com/org/repo.git', 'https://github.com/org/repo.git'],
    ['https://alice%40example.com:secret%3Atoken@github.com/org/repo.git', 'https://github.com/org/repo.git'],
    ['file://alice:secret@localhost/repo.git', 'file://localhost/repo.git'],
    ['ssh://git:secret@github.com/org/repo.git', 'ssh://git@github.com/org/repo.git'],
    ['ssh://alice@github.com/org/repo.git', 'ssh://github.com/org/repo.git'],
    ['alice@github.com:org/repo.git', 'github.com:org/repo.git'],
    ['git@github.com:org/repo.git', 'git@github.com:org/repo.git'],
    ['alice@[2001:db8::1]:org/repo.git', '[2001:db8::1]:org/repo.git'],
    ['git@[2001:db8::1]:org/repo.git', 'git@[2001:db8::1]:org/repo.git'],
    ['hg::https://alice:secret@example.invalid/org/repo.git', 'hg::https://example.invalid/org/repo.git'],
    ['remote-hg::file://alice:secret@server/share/repo.git', 'remote-hg::file://server/share/repo.git'],
  ])('sanitizes %s', (remote, expected) => {
    expect(sanitizeGitRemoteUrl(remote)).toBe(expected)
  })

  it('preserves encoded and opaque repository paths', () => {
    expect(sanitizeGitRemoteUrl(
      'https://alice:secret@example.invalid/org/a%2Fb%3Fc%23d.git',
    )).toBe('https://example.invalid/org/a%2Fb%3Fc%23d.git')
    expect(sanitizeGitRemoteUrl('alice@[::1]:dir name/repo'))
      .toBe('[::1]:dir name/repo')
  })

  it('handles deeply nested helpers without recursion', () => {
    const prefix = 'hg::'.repeat(4096)
    expect(sanitizeGitRemoteUrl(
      `${prefix}https://alice:secret@example.invalid/org/repo.git`,
    )).toBe(`${prefix}https://example.invalid/org/repo.git`)
  })

  it('rejects helper commands and malformed URLs without echoing secrets', () => {
    for (const remote of [
      'ext::sshpass -p secret-token ssh alice@example.com git-upload-pack /repo',
      'https://alice:secret-token@[invalid',
    ]) {
      try {
        sanitizeGitRemoteUrl(remote)
        throw new Error('expected sanitization to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidGitRemoteUrlError)
        expect(String(error)).not.toContain('secret-token')
      }
    }
  })

  it('drops malformed legacy values in the tolerant form', () => {
    expect(sanitizeOptionalGitRemoteUrl('https://alice:secret-token@[invalid'))
      .toBeUndefined()
    expect(sanitizeOptionalGitRemoteUrl(null)).toBeUndefined()
  })
})

describe('rollout header boundary', () => {
  it('sanitizes legacy repository URLs before exposing parsed metadata', () => {
    const parsed = parseRolloutText(JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'session-1',
        git: {
          commit_hash: 'abc123',
          repository_url: 'https://alice:secret-token@github.com/org/repo.git',
        },
      },
    }))

    expect(parsed.header.payload.git).toEqual({
      commit_hash: 'abc123',
      repository_url: 'https://github.com/org/repo.git',
    })
  })

  it('drops malformed legacy repository URLs without losing the header', () => {
    const parsed = parseRolloutText(JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'session-1',
        git: { repository_url: 'https://alice:secret-token@[invalid' },
      },
    }))

    expect(parsed.header.payload.id).toBe('session-1')
    expect(parsed.header.payload.git).toEqual({})
  })
})
