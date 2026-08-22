import { describe, it, expect } from 'vitest';
import { catalogBudgetTokens, truncateDescription, renderCatalog } from '../src/index';

describe('catalog budget (ported from render.rs)', () => {
  it('falls back to 8000 chars without window info', () => {
    expect(catalogBudgetTokens()).toBe(8000);
  });
  it('uses 2% of context window', () => {
    expect(catalogBudgetTokens(200000)).toBe(4000);
  });
  it('caps at hard limit', () => {
    expect(catalogBudgetTokens(1000000)).toBe(10000);
  });
  it('truncates long descriptions with ellipsis', () => {
    const s = truncateDescription('x'.repeat(2000));
    expect(s.length).toBe(1024);
    expect(s.endsWith('…')).toBe(true);
  });
  it('renderCatalog respects budget and reports omissions', () => {
    const entries = Array.from({length:50},(_,i)=>({name:'skill-'+i,description:'d'.repeat(300)}));
    const r = renderCatalog(entries, 5000);
    expect(r.included).toBeLessThan(50);
    expect(r.omitted).toBeGreaterThan(0);
    expect(r.text.length).toBeLessThanOrEqual(5200);
  });
});
