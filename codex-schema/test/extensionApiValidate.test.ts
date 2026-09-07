import { describe, it, expect } from 'vitest';
import { validateExtensionToolSpec } from '../src/handwritten/extension-api/validate';

describe('extension-api tool spec validation (M1 → executable)', () => {
  it('accepts a well-formed tool spec', () => {
    expect(validateExtensionToolSpec({
      name: 'my_ext.search',
      description: 'search things',
      inputSchema: { type: 'object', properties: {} },
      deferLoading: false,
    }).ok).toBe(true);
  });
  it('rejects malformed specs', () => {
    expect(validateExtensionToolSpec({ name: 'bad name!', description: 'd', inputSchema: {}, deferLoading: true }).ok).toBe(false);
    expect(validateExtensionToolSpec({ name: 'ok', inputSchema: {}, deferLoading: true }).ok).toBe(false);
    expect(validateExtensionToolSpec({ name: 'ok', description: 'd', deferLoading: true }).ok).toBe(false);
  });
});
