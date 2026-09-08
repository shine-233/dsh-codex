// Differential tests: replay upstream Rust test vectors (extracted from
// rust-v0.153.4 sources by differential/extract-command-safety.mjs) against
// the TS distillations. This is the machine-level fidelity gate: every vector
// is an upstream assertion, and any TS behavior that diverges shows up here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dangerousCommandMatch,
  dangerousCommandMatchLine,
  isDangerousCommandWindows,
  isDangerousPowershellWords,
} from '../../codex-policy-engine/src/commandSafety';
import {
  formattedTruncateText,
  truncateText,
} from '../../codex-policy-engine/src/outputTruncation';

const DIFF = join(__dirname, '..', 'differential');
const readVectorJson = (f: string) => JSON.parse(readFileSync(join(DIFF, 'vectors', f), 'utf8'));

const commandSafety = readVectorJson('commandSafety.json');
const truncation = readVectorJson('outputTruncation.json');

describe('differential: shell-command dangerous-command classifier', () => {
  const posix: [string, string, string[], string | null][] = commandSafety.posix
    .filter((v: any) => !v.dynamic)
    .map((v: any) => [v.fn, v.call, v.argv, v.expected]);
  it.each(posix)(
    'posix %s (%s): %j',
    (fn, call, argv, expected) => {
      if (call === 'dangerous_powershell_words_match') {
        // upstream asserts the powershell word-scan directly on Windows semantics
        expect(isDangerousPowershellWords(argv) ? 'Other' : null).toBe(expected);
        return;
      }
      expect(dangerousCommandMatch(argv, { platform: 'posix' })).toBe(expected);
    },
  );

  const windows: [string, string[], boolean][] = commandSafety.windows
    .map((v: any) => [v.fn, v.argv, v.expected]);
  it.each(windows)(
    'windows %s: %j',
    (_fn, argv, expected) => {
      expect(isDangerousCommandWindows(argv)).toBe(expected);
    },
  );
});

describe('differential: output-truncation', () => {
  const formatted: [string, string, any, string][] = truncation.formattedTruncateText
    .map((v: any) => [v.fn, v.content, v.policy, v.expected]);
  it.each(formatted)(
    'formattedTruncateText %s',
    (_fn, content, policy, expected) => {
      expect(formattedTruncateText(content, policy)).toBe(expected);
    },
  );
  const plain: [string, string, any, string][] = truncation.truncateText
    .map((v: any) => [v.fn, v.content, v.policy, v.expected]);
  it.each(plain)(
    'truncateText %s',
    (_fn, content, policy, expected) => {
      expect(truncateText(content, policy)).toBe(expected);
    },
  );
});
