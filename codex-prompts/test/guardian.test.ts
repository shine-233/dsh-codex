import { describe, it, expect } from 'vitest';
import { buildSyncReviewPrompt, buildAsyncScoringPrompt, sharedContextSection } from '../src/guardian';
import type { GuardianTranscriptEntry } from '../src/guardian';

describe('guardian-v2 prompts (distilled from ext/guardian-v2 + guardian-context)', () => {
  const transcript: GuardianTranscriptEntry[] = [
    { role: 'user', text: 'deploy to prod' },
    { role: 'tool', text: 'build ok' },
    { role: 'assistant', text: 'deploying now' },
  ];
  it('sync review prompt asks for APPROVE/REJECT over bounded transcript', () => {
    const p = buildSyncReviewPrompt(transcript);
    expect(p).toContain('APPROVE or REJECT');
    expect(p).toContain('[assistant] deploying now');
  });
  it('async scoring prompt is non-blocking and bounded', () => {
    const p = buildAsyncScoringPrompt(transcript, { maxEntryChars: 10 });
    expect(p).toContain('asynchronous');
    expect(sharedContextSection(transcript).length).toBeGreaterThan(0);
  });
  it('transcript bounds truncate entries from the head', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, text: `m${i}` }));
    const section = sharedContextSection(many, { maxEntries: 5 });
    expect(section).toContain('m49');
    expect(section).not.toContain('m44');
  });
});
