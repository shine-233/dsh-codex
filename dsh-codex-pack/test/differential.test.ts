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
  const posix = commandSafety.posix.filter((v: any) => !v.dynamic);
  it.each(posix.map((v: any) => [v.fn, v.call, v.argv, v.expected]))(
    'posix %s (%s): %j',
    (...args: any[]) => {
      const [fn, call, argv, expected] = args as [string, string, string[], string | null]
      if (call === 'dangerous_powershell_words_match') {
        // upstream asserts the powershell word-scan directly on Windows semantics
        expect(isDangerousPowershellWords(argv) ? 'Other' : null).toBe(expected);
        return;
      }
      expect(dangerousCommandMatch(argv, { platform: 'posix' })).toBe(expected);
    },
  );

  const windows = commandSafety.windows;
  it.each(windows.map((v: any) => [v.fn, v.argv, v.expected]))(
    'windows %s: %j',
    (...args: any[]) => {
      const [fn, argv, expected] = args as [string, string[], boolean]
      expect(isDangerousCommandWindows(argv)).toBe(expected);
    },
  );
});

describe('differential: output-truncation', () => {
  it.each(truncation.formattedTruncateText.map((v: any) => [v.fn, v.content, v.policy, v.expected]))(
    'formattedTruncateText %s',
    (...args: any[]) => {
      const [_fn, content, policy, expected] = args as [string, string, any, string]
      expect(formattedTruncateText(content, policy)).toBe(expected);
    },
  );
  it.each(truncation.truncateText.map((v: any) => [v.fn, v.content, v.policy, v.expected]))(
    'truncateText %s',
    (...args: any[]) => {
      const [_fn, content, policy, expected] = args as [string, string, any, string]
      expect(truncateText(content, policy)).toBe(expected);
    },
  );
});
