import { describe, it, expect } from 'vitest';
import { listTemplates, loadTemplate, buildSystemPrompt } from '../src/index';
describe('vendored prompt assets', () => {
  it('has extracted upstream templates', () => {
    expect(listTemplates().length).toBeGreaterThan(0);
  });
  it('loads non-empty text', () => {
    const t = listTemplates()[0];
    expect(loadTemplate(t).length).toBeGreaterThan(20);
  });
  it('substitutes placeholders', () => {
    expect(buildSystemPrompt([], {})).toBe('');
  });
});
