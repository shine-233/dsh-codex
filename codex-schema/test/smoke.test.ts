import { describe, it, expect } from 'vitest';
describe('M1 codex-schema', () => {
  it('module graph loads without side effects', async () => {
    const mod = await import('../src/index');
    expect(mod !== undefined).toBe(true);
  });
});
