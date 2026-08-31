import { describe, expect, it } from 'vitest'
import { apply, binPaths, name } from '../src/dsh-plugin.js'

describe('codex-sandbox-bin DSH contract', () => {
  it('reports the current platform and vendored binaries without executing them', () => {
    const info = binPaths()
    expect(info.platformKey).toMatch(/^(windows|linux|darwin)-/)
    expect(info.dir).toContain('codex-sandbox-bin')
    expect(Object.keys(info.binaries).length).toBeGreaterThan(0)
    for (const binary of Object.values(info.binaries) as Array<{ bytes: number }>) {
      expect(binary.bytes).toBeGreaterThan(0)
    }
  })

  it('registers the status tool through the DSH host contract', async () => {
    const tools: Array<{ name: string; execute: () => Promise<string> }> = []
    apply({ tools: { register: (tool: any) => tools.push(tool) } } as any)
    expect(name).toBe('codex-sandbox-bin')
    expect(tools.map((tool) => tool.name)).toEqual(['codex_sandbox_status'])
    const result = JSON.parse(await tools[0].execute())
    expect(result.available).toBe(true)
    expect(result.platformKey).toBe(binPaths().platformKey)
  })
})
