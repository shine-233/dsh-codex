// Ported 1:1 from openai/codex shell-command/src/parse_command.rs tests
// (lines 86-1422) and shell-command/src/bash.rs tests (Apache-2.0, anchor
// rust-v0.153.4). These are the fidelity gate for the P1-1 grammar port:
// expected values are the upstream ones, unchanged.
import { describe, it, expect } from 'vitest';
import {
  parseCommand, parseCommandImpl, isSmallFormattingCommand, isPathish,
  extractBashCommand, parseShellLcPlainCommands as parseShellLcPlain,
  type ParsedCommand,
} from '../src/parseCommand/parseCommand';
import { shlexSplit, shlexJoin } from '../src/parseCommand/shlex';
import { parseShellScriptIntoCommands } from '../src/parseCommand/bashWordSeq';

function shlexSplitSafe(s: string): string[] {
  return shlexSplit(s) ?? s.split(/[ \t\n]+/).filter((t) => t !== '');
}

function vecStr(args: string[]): string[] {
  return [...args];
}

const U = (cmd: string): ParsedCommand => ({ type: 'unknown', cmd });
const LF = (cmd: string, path: string | null): ParsedCommand => ({ type: 'list_files', cmd, path });
const SE = (cmd: string, query: string | null, path: string | null): ParsedCommand => ({ type: 'search', cmd, query, path });
const RD = (cmd: string, name: string, path: string): ParsedCommand => ({ type: 'read', cmd, name, path });

function assertParsed(args: string[], expected: ParsedCommand[]) {
  expect(parseCommand(args)).toEqual(expected);
}

describe('parse_command (port of upstream parse_command.rs tests)', () => {
  it('git_status_is_unknown', () => {
    assertParsed(vecStr(['git', 'status']), [U('git status')]);
  });

  it('supports_git_grep_and_ls_files', () => {
    assertParsed(shlexSplitSafe('git grep TODO src'), [SE('git grep TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('git grep -l TODO src'), [SE('git grep -l TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('git ls-files'), [LF('git ls-files', null)]);
    assertParsed(shlexSplitSafe('git ls-files src'), [LF('git ls-files src', 'src')]);
    assertParsed(shlexSplitSafe('git ls-files --exclude target src'), [LF('git ls-files --exclude target src', 'src')]);
  });

  it('handles_git_pipe_wc', () => {
    const inner = 'git status | wc -l';
    assertParsed(vecStr(['bash', '-lc', inner]), [U(inner)]);
  });

  it('bash_lc_redirect_not_quoted', () => {
    const inner = 'echo foo > bar';
    assertParsed(vecStr(['bash', '-lc', inner]), [U('echo foo > bar')]);
  });

  it('handles_complex_bash_command_head', () => {
    const inner = 'rg --version && node -v && pnpm -v && rg --files | wc -l && rg --files | head -n 40';
    assertParsed(vecStr(['bash', '-lc', inner]), [U(inner)]);
  });

  it('supports_searching_for_navigate_to_route', () => {
    const inner = 'rg -n "navigate-to-route" -S';
    assertParsed(vecStr(['bash', '-lc', inner]), [SE('rg -n navigate-to-route -S', 'navigate-to-route', null)]);
  });

  it('handles_complex_bash_command', () => {
    const inner = 'rg -n "BUG|FIXME|TODO|XXX|HACK" -S | head -n 200';
    assertParsed(vecStr(['bash', '-lc', inner]), [SE("rg -n 'BUG|FIXME|TODO|XXX|HACK' -S", 'BUG|FIXME|TODO|XXX|HACK', null)]);
  });

  it('supports_rg_files_with_path_and_pipe', () => {
    const inner = 'rg --files webview/src | sed -n';
    assertParsed(vecStr(['bash', '-lc', inner]), [LF('rg --files webview/src', 'webview')]);
  });

  it('supports_rg_files_then_head', () => {
    const inner = 'rg --files | head -n 50';
    assertParsed(vecStr(['bash', '-lc', inner]), [LF('rg --files', null)]);
  });

  it('keeps_mutating_xargs_pipeline', () => {
    const inner = "rg -l QkBindingController presentation/src/main/java | xargs perl -pi -e 's/QkBindingController/QkController/g'";
    assertParsed(vecStr(['bash', '-lc', inner]), [U(inner)]);
  });

  it('collapses_plain_pipeline_when_any_stage_is_unknown', () => {
    const command = shlexSplitSafe(
      "rg -l QkBindingController presentation/src/main/java | xargs perl -pi -e 's/QkBindingController/QkController/g'",
    );
    assertParsed(command, [U(shlexJoin(command))]);
  });

  it('collapses_pipeline_with_helper_when_later_stage_is_unknown', () => {
    const command = shlexSplitSafe('rg --files | nl -ba | foo');
    assertParsed(command, [U(shlexJoin(command))]);
  });

  it('rg_files_with_matches_flags_are_search', () => {
    assertParsed(shlexSplitSafe('rg -l TODO src'), [SE('rg -l TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('rg --files-with-matches TODO src'), [SE('rg --files-with-matches TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('rg -L TODO src'), [SE('rg -L TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('rg --files-without-match TODO src'), [SE('rg --files-without-match TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('rga -l TODO src'), [SE('rga -l TODO src', 'TODO', 'src')]);
  });

  it('supports_cat', () => {
    const inner = 'cat webview/README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'webview/README.md')]);
  });

  it('zsh_lc_supports_cat', () => {
    const inner = 'cat README.md';
    assertParsed(vecStr(['zsh', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_bat', () => {
    const inner = 'bat --theme TwoDark README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_batcat', () => {
    const inner = 'batcat README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_less', () => {
    const inner = 'less -p TODO README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_more', () => {
    const inner = 'more README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('cd_then_cat_is_single_read', () => {
    assertParsed(shlexSplitSafe('cd foo && cat foo.txt'), [RD('cat foo.txt', 'foo.txt', 'foo/foo.txt')]);
  });

  it('cd_with_double_dash_then_cat_is_read', () => {
    assertParsed(shlexSplitSafe('cd -- -weird && cat foo.txt'), [RD('cat foo.txt', 'foo.txt', '-weird/foo.txt')]);
  });

  it('cd_with_multiple_operands_uses_last', () => {
    assertParsed(shlexSplitSafe('cd dir1 dir2 && cat foo.txt'), [RD('cat foo.txt', 'foo.txt', 'dir2/foo.txt')]);
  });

  it('bash_cd_then_bar_is_same_as_bar', () => {
    assertParsed(shlexSplitSafe("bash -lc 'cd foo && bar'"), [U('cd foo && bar')]);
  });

  it('bash_cd_then_cat_is_read', () => {
    assertParsed(shlexSplitSafe("bash -lc 'cd foo && cat foo.txt'"), [RD('cat foo.txt', 'foo.txt', 'foo/foo.txt')]);
  });

  it('supports_ls_with_pipe', () => {
    const inner = "ls -la | sed -n '1,120p'";
    assertParsed(vecStr(['bash', '-lc', inner]), [LF('ls -la', null)]);
  });

  it('supports_eza_exa_tree_du', () => {
    assertParsed(shlexSplitSafe('eza --color=always src'), [LF("eza '--color=always' src", 'src')]);
    assertParsed(shlexSplitSafe('exa -I target .'), [LF('exa -I target .', '.')]);
    assertParsed(shlexSplitSafe('tree -L 2 src'), [LF('tree -L 2 src', 'src')]);
    assertParsed(shlexSplitSafe('du -d 2 .'), [LF('du -d 2 .', '.')]);
  });

  it('supports_head_n', () => {
    const inner = 'head -n 50 Cargo.toml';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'Cargo.toml', 'Cargo.toml')]);
  });

  it('supports_head_file_only', () => {
    const inner = 'head Cargo.toml';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'Cargo.toml', 'Cargo.toml')]);
  });

  it('supports_cat_sed_n', () => {
    const inner = "cat tui/Cargo.toml | sed -n '1,200p'";
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'Cargo.toml', 'tui/Cargo.toml')]);
  });

  it('supports_tail_n_plus', () => {
    const inner = 'tail -n +522 README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_tail_n_last_lines', () => {
    const inner = 'tail -n 30 README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_tail_file_only', () => {
    const inner = 'tail README.md';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'README.md', 'README.md')]);
  });

  it('supports_npm_run_build_is_unknown', () => {
    assertParsed(vecStr(['npm', 'run', 'build']), [U('npm run build')]);
  });

  it('supports_grep_recursive_current_dir', () => {
    assertParsed(vecStr(['grep', '-R', 'CODEX_SANDBOX_ENV_VAR', '-n', '.']), [SE('grep -R CODEX_SANDBOX_ENV_VAR -n .', 'CODEX_SANDBOX_ENV_VAR', '.')]);
  });

  it('supports_grep_recursive_specific_file', () => {
    assertParsed(
      vecStr(['grep', '-R', 'CODEX_SANDBOX_ENV_VAR', '-n', 'core/src/spawn.rs']),
      [SE('grep -R CODEX_SANDBOX_ENV_VAR -n core/src/spawn.rs', 'CODEX_SANDBOX_ENV_VAR', 'spawn.rs')],
    );
  });

  it('supports_egrep_and_fgrep', () => {
    assertParsed(shlexSplitSafe('egrep -R TODO src'), [SE('egrep -R TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('fgrep -l TODO src'), [SE('fgrep -l TODO src', 'TODO', 'src')]);
  });

  it('grep_files_with_matches_flags_are_search', () => {
    assertParsed(shlexSplitSafe('grep -l TODO src'), [SE('grep -l TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('grep --files-with-matches TODO src'), [SE('grep --files-with-matches TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('grep -L TODO src'), [SE('grep -L TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('grep --files-without-match TODO src'), [SE('grep --files-without-match TODO src', 'TODO', 'src')]);
  });

  it('supports_grep_query_with_slashes_not_shortened', () => {
    assertParsed(shlexSplitSafe('grep -R src/main.rs -n .'), [SE('grep -R src/main.rs -n .', 'src/main.rs', '.')]);
  });

  it('supports_grep_weird_backtick_in_query', () => {
    assertParsed(shlexSplitSafe('grep -R COD`EX_SANDBOX -n'), [SE("grep -R 'COD`EX_SANDBOX' -n", 'COD`EX_SANDBOX', null)]);
  });

  it('supports_cd_and_rg_files', () => {
    assertParsed(shlexSplitSafe('cd codex-rs && rg --files'), [LF('rg --files', null)]);
  });

  it('supports_single_string_script_with_cd_and_pipe', () => {
    const inner = 'cd /Users/pakrym/code/codex && rg -n "codex_api" codex-rs -S | head -n 50';
    assertParsed(vecStr(['bash', '-lc', inner]), [SE('rg -n codex_api codex-rs -S', 'codex_api', 'codex-rs')]);
  });

  it('supports_python_walks_files', () => {
    const inner = 'python -c "import os; print(os.listdir(\'.\'))"';
    assertParsed(
      vecStr(['bash', '-lc', inner]),
      [LF(shlexJoin(shlexSplitSafe(inner)), null)],
    );
  });

  it('supports_python3_walks_files', () => {
    const inner = `python3 -c "import glob; print(glob.glob('*.rs'))"`;
    assertParsed(vecStr(['bash', '-lc', inner]), [LF(shlexJoin(shlexSplitSafe(inner)), null)]);
  });

  it('python_without_file_walk_is_unknown', () => {
    const inner = `python -c "print('hello')"`;
    assertParsed(vecStr(['bash', '-lc', inner]), [U(shlexJoin(shlexSplitSafe(inner)))]);
  });

  // ---- is_small_formatting_command unit tests ----
  it('small_formatting_always_true_commands', () => {
    for (const cmd of ['wc', 'tr', 'cut', 'sort', 'uniq', 'xargs', 'tee', 'column']) {
      expect(isSmallFormattingCommand(shlexSplitSafe(cmd))).toBe(true);
      expect(isSmallFormattingCommand(shlexSplitSafe(`${cmd} -x`))).toBe(true);
    }
  });

  it('awk_behavior', () => {
    expect(isSmallFormattingCommand(shlexSplitSafe("awk '{print $1}'"))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe("awk '{print $1}' Cargo.toml"))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('awk -f script.awk Cargo.toml'))).toBe(false);
  });

  it('head_behavior', () => {
    expect(isSmallFormattingCommand(vecStr(['head']))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('head -n 40'))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('head -n 40 file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(vecStr(['head', 'file.txt']))).toBe(false);
  });

  it('tail_behavior', () => {
    expect(isSmallFormattingCommand(vecStr(['tail']))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('tail -n +10'))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('tail -n +10 file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('tail -n 30'))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('tail -n 30 file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('tail -c 30'))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('tail -c +10'))).toBe(true);
    expect(isSmallFormattingCommand(vecStr(['tail', 'file.txt']))).toBe(false);
  });

  it('sed_behavior', () => {
    expect(isSmallFormattingCommand(vecStr(['sed']))).toBe(true);
    expect(isSmallFormattingCommand(vecStr(['sed', '-n', '10p']))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('sed -n 10p file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('sed -n -e 10p file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('sed -n 10p -- file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('sed -n 1,200p file.txt'))).toBe(false);
    expect(isSmallFormattingCommand(shlexSplitSafe('sed -n p file.txt'))).toBe(true);
    expect(isSmallFormattingCommand(shlexSplitSafe('sed -n +10p file.txt'))).toBe(true);
  });

  it('keeps_mutating_sed_in_compound_command', () => {
    for (const sedCommand of [
      'sed -n -i.bak 1p secret.txt',
      'sed -ni.bak 1p secret.txt',
      'sed -Eni.bak 1p secret.txt',
    ]) {
      const inner = `cat README.md && ${sedCommand}`;
      assertParsed(vecStr(['bash', '-lc', inner]), [U(inner)]);
    }
  });

  it('ignores_sed_operands_after_double_dash_when_checking_mutation', () => {
    const inner = "cat README.md && sed 's/a/x/' -- -input.txt";
    assertParsed(vecStr(['bash', '-lc', inner]), [RD('cat README.md', 'README.md', 'README.md')]);
  });

  it('empty_tokens_is_not_small', () => {
    expect(isSmallFormattingCommand([])).toBe(false);
  });

  it('supports_nl_then_sed_reading', () => {
    const inner = "nl -ba core/src/parse_command.rs | sed -n '1200,1720p'";
    assertParsed(vecStr(['bash', '-lc', inner]), [RD(inner, 'parse_command.rs', 'core/src/parse_command.rs')]);
  });

  it('supports_sed_n', () => {
    const inner = "sed -n '2000,2200p' tui/src/history_cell.rs";
    assertParsed(shlexSplitSafe(inner), [RD("sed -n '2000,2200p' tui/src/history_cell.rs", 'history_cell.rs', 'tui/src/history_cell.rs')]);
  });

  it('supports_awk_with_file', () => {
    const inner = "awk '{print $1}' Cargo.toml";
    assertParsed(shlexSplitSafe(inner), [RD("awk '{print $1}' Cargo.toml", 'Cargo.toml', 'Cargo.toml')]);
  });

  it('filters_out_printf', () => {
    const inner = 'printf "\\n===== ansi-escape/Cargo.toml =====\\n"; cat -- ansi-escape/Cargo.toml';
    assertParsed(vecStr(['bash', '-lc', inner]), [RD('cat -- ansi-escape/Cargo.toml', 'Cargo.toml', 'ansi-escape/Cargo.toml')]);
  });

  it('drops_yes_in_pipelines', () => {
    const inner = 'yes | rg --files';
    assertParsed(vecStr(['bash', '-lc', inner]), [LF('rg --files', null)]);
  });

  it('supports_sed_n_then_nl_as_search', () => {
    const args = shlexSplitSafe(
      "sed -n '260,640p' exec/src/event_processor_with_human_output.rs | nl -ba",
    );
    assertParsed(args, [RD("sed -n '260,640p' exec/src/event_processor_with_human_output.rs", 'event_processor_with_human_output.rs', 'exec/src/event_processor_with_human_output.rs')]);
  });

  it('preserves_rg_with_spaces', () => {
    assertParsed(shlexSplitSafe("yes | rg -n 'foo bar' -S"), [SE("rg -n 'foo bar' -S", 'foo bar', null)]);
  });

  it('ls_with_glob', () => {
    assertParsed(shlexSplitSafe("ls -I '*.test.js'"), [LF("ls -I '*.test.js'", null)]);
  });

  it('strips_true_in_sequence', () => {
    assertParsed(shlexSplitSafe('true && rg --files'), [LF('rg --files', null)]);
    assertParsed(shlexSplitSafe('rg --files && true'), [LF('rg --files', null)]);
  });

  it('strips_true_inside_bash_lc', () => {
    assertParsed(vecStr(['bash', '-lc', 'true && rg --files']), [LF('rg --files', null)]);
    assertParsed(vecStr(['bash', '-lc', 'rg --files || true']), [LF('rg --files', null)]);
  });

  it('shorten_path_on_windows', () => {
    assertParsed(shlexSplitSafe('cat "pkg\\src\\main.rs"'), [RD('cat "pkg\\\\src\\\\main.rs"', 'main.rs', 'pkg\\src\\main.rs')]);
  });

  it('head_with_no_space', () => {
    assertParsed(shlexSplitSafe("bash -lc 'head -n50 Cargo.toml'"), [RD('head -n50 Cargo.toml', 'Cargo.toml', 'Cargo.toml')]);
  });

  it('bash_dash_c_pipeline_parsing', () => {
    const inner = 'rg --files | head -n 1';
    assertParsed(vecStr(['bash', '-c', inner]), [LF('rg --files', null)]);
  });

  it('tail_with_no_space', () => {
    assertParsed(shlexSplitSafe("bash -lc 'tail -n+10 README.md'"), [RD('tail -n+10 README.md', 'README.md', 'README.md')]);
  });

  it('grep_with_query_and_path', () => {
    assertParsed(shlexSplitSafe('grep -R TODO src'), [SE('grep -R TODO src', 'TODO', 'src')]);
  });

  it('supports_ag_ack_pt_rga', () => {
    assertParsed(shlexSplitSafe('ag TODO src'), [SE('ag TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('ack TODO src'), [SE('ack TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('pt TODO src'), [SE('pt TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('rga TODO src'), [SE('rga TODO src', 'TODO', 'src')]);
  });

  it('ag_ack_pt_files_with_matches_flags_are_search', () => {
    assertParsed(shlexSplitSafe('ag -l TODO src'), [SE('ag -l TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('ack -l TODO src'), [SE('ack -l TODO src', 'TODO', 'src')]);
    assertParsed(shlexSplitSafe('pt -l TODO src'), [SE('pt -l TODO src', 'TODO', 'src')]);
  });

  it('rg_with_equals_style_flags', () => {
    assertParsed(shlexSplitSafe('rg --colors=never -n foo src'), [SE("rg '--colors=never' -n foo src", 'foo', 'src')]);
  });

  it('cat_with_double_dash_and_sed_ranges', () => {
    assertParsed(shlexSplitSafe('cat -- ./-strange-file-name'), [RD('cat -- ./-strange-file-name', '-strange-file-name', './-strange-file-name')]);
    assertParsed(shlexSplitSafe("sed -n '12,20p' Cargo.toml"), [RD("sed -n '12,20p' Cargo.toml", 'Cargo.toml', 'Cargo.toml')]);
  });

  it('drop_trailing_nl_in_pipeline', () => {
    assertParsed(shlexSplitSafe('rg --files | nl -ba'), [LF('rg --files', null)]);
  });

  it('ls_with_time_style_and_path', () => {
    assertParsed(shlexSplitSafe('ls --time-style=long-iso ./dist'), [LF("ls '--time-style=long-iso' ./dist", '.')]);
  });

  it('fd_file_finder_variants', () => {
    assertParsed(shlexSplitSafe('fd -t f src/'), [LF('fd -t f src/', 'src')]);
    assertParsed(shlexSplitSafe('fd main src'), [SE('fd main src', 'main', 'src')]);
  });

  it('find_basic_name_filter', () => {
    assertParsed(shlexSplitSafe("find . -name '*.rs'"), [SE("find . -name '*.rs'", '*.rs', '.')]);
  });

  it('find_type_only_path', () => {
    assertParsed(shlexSplitSafe('find src -type f'), [LF('find src -type f', 'src')]);
  });

  it('bin_bash_lc_sed', () => {
    assertParsed(shlexSplitSafe("/bin/bash -lc 'sed -n '1,10p' Cargo.toml'"), [RD("sed -n '1,10p' Cargo.toml", 'Cargo.toml', 'Cargo.toml')]);
  });

  it('bin_zsh_lc_sed', () => {
    assertParsed(shlexSplitSafe("/bin/zsh -lc 'sed -n '1,10p' Cargo.toml'"), [RD("sed -n '1,10p' Cargo.toml", 'Cargo.toml', 'Cargo.toml')]);
  });

  it('powershell_command_is_stripped', () => {
    assertParsed(vecStr(['powershell', '-Command', 'Get-ChildItem']), [U('Get-ChildItem')]);
  });

  it('powershell_file_reads_are_classified', () => {
    const cases: Array<[string, string, string]> = [
      ['powershell', 'Get-Content C:\\skills\\demo\\SKILL.md', 'C:/skills/demo/SKILL.md'],
      ['powershell', 'get-content -Raw "C:\\skills and plugins\\SKILL.md"', 'C:/skills and plugins/SKILL.md'],
      ['powershell', "Get-Content 'C:\\skills and plugins\\SKILL.md'", 'C:/skills and plugins/SKILL.md'],
      ['powershell', 'Get-Content -Path C:\\skills\\demo\\SKILL.md', 'C:/skills/demo/SKILL.md'],
      ['powershell', 'Get-Content -LiteralPath C:\\skills\\demo\\SKILL.md', 'C:/skills/demo/SKILL.md'],
      ['powershell', 'Get-Content C:\\skills\\demo\\SKILL.md -Raw', 'C:/skills/demo/SKILL.md'],
      ['powershell', 'Get-Content -Raw -LiteralPath C:\\skills\\demo\\SKILL.md', 'C:/skills/demo/SKILL.md'],
      ['powershell', 'Get-Content C:\\workspace\\README.md', 'C:/workspace/README.md'],
      ['powershell', 'gc C:/skills/demo/SKILL.md', 'C:/skills/demo/SKILL.md'],
      ['powershell', 'type C:/skills/demo/SKILL.md', 'C:/skills/demo/SKILL.md'],
      ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'Get-Content C:/skills/demo/SKILL.md', 'C:/skills/demo/SKILL.md'],
    ];
    for (const [shell, script, path] of cases) {
      const name = path.split(/[\\/]/).pop() as string;
      assertParsed(vecStr([shell, '-NoProfile', '-Command', script]), [RD(script, name, path)]);
    }
  });

  it('complex_powershell_file_reads_are_intentionally_not_classified', () => {
    for (const script of [
      "Get-Content 'C:\\Users\\O''Brien\\skill\\SKILL.md'",
      'Get-Content "$(Remove-Item C:/important)/skills/demo/SKILL.md"',
      "Get-Content -ReadCount:([IO.File]::Delete('C:/important')) C:/skills/demo/SKILL.md",
      'Get-Content C:/Users/Alice/.ssh/id_rsa,C:/skills/demo/SKILL.md',
      'Get-Content C:/skills/demo/SKILL.md -Raw; Remove-Item C:/important',
      'Get-Content C:/skills/demo/SKILL.md C:/important',
      'Get-Content C:/skills/*/SKILL.md',
      'Get-Content -Encoding UTF8 C:/skills/demo/SKILL.md',
      'Get-Content -Raw',
    ]) {
      assertParsed(vecStr(['powershell', '-Command', script]), [U(script)]);
    }
  });

  it('pwsh_with_noprofile_and_c_alias_is_stripped', () => {
    assertParsed(vecStr(['pwsh', '-NoProfile', '-c', 'Write-Host hi']), [U('Write-Host hi')]);
  });

  it('powershell_with_path_is_stripped', () => {
    const command = 'C:\\windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    assertParsed(vecStr([command, '-NoProfile', '-c', 'Write-Host hi']), [U('Write-Host hi')]);
  });
});

// ── bash.rs word-only sequence contract (port of parse_seq tests) ────────────

describe('bash word-only sequences (port of upstream bash.rs tests)', () => {
  const parseSeq = parseShellScriptIntoCommands;
  // upstream bash.rs: parse_shell_lc_plain_commands (now a real export)
  const parseShellLcPlainCommands = parseShellLcPlain;

  it('accepts_single_simple_command', () => {
    expect(parseSeq('ls -1')).toEqual([['ls', '-1']]);
  });
  it('accepts_multiple_commands_with_allowed_operators', () => {
    expect(parseSeq("ls && pwd; echo 'hi there' | wc -l")).toEqual([
      ['ls'], ['pwd'], ['echo', 'hi there'], ['wc', '-l'],
    ]);
  });
  it('extracts_double_and_single_quoted_strings', () => {
    expect(parseSeq('echo "hello world"')).toEqual([['echo', 'hello world']]);
    expect(parseSeq("echo 'hi there'")).toEqual([['echo', 'hi there']]);
  });
  it('accepts_double_quoted_strings_with_newlines', () => {
    expect(parseSeq('git commit -m "line1\nline2"')).toEqual([['git', 'commit', '-m', 'line1\nline2']]);
  });
  it('accepts_mixed_quote_concatenation', () => {
    expect(parseSeq('echo "/usr"\'/\'"local"/bin')).toEqual([['echo', '/usr/local/bin']]);
    expect(parseSeq(`echo '/usr'"/"'local'/bin`)).toEqual([['echo', '/usr/local/bin']]);
  });
  it('rejects_double_quoted_strings_with_expansions', () => {
    expect(parseSeq('echo "hi ${USER}"')).toBeNull();
    expect(parseSeq('echo "$HOME"')).toBeNull();
  });
  it('accepts_numbers_as_words', () => {
    expect(parseSeq('echo 123 456')).toEqual([['echo', '123', '456']]);
  });
  it('rejects_parentheses_and_subshells', () => {
    expect(parseSeq('(ls)')).toBeNull();
    expect(parseSeq('ls || (pwd && echo hi)')).toBeNull();
  });
  it('rejects_redirections_and_unsupported_operators', () => {
    expect(parseSeq('ls > out.txt')).toBeNull();
    expect(parseSeq('echo hi & echo bye')).toBeNull();
  });
  it('rejects_command_and_process_substitutions_and_expansions', () => {
    expect(parseSeq('echo $(pwd)')).toBeNull();
    expect(parseSeq('echo `pwd`')).toBeNull();
    expect(parseSeq('echo $HOME')).toBeNull();
    expect(parseSeq('echo "hi $USER"')).toBeNull();
  });
  it('rejects_variable_assignment_prefix', () => {
    expect(parseSeq('FOO=bar ls')).toBeNull();
  });
  it('rejects_trailing_operator_parse_error', () => {
    expect(parseSeq('ls &&')).toBeNull();
  });
  it('rejects_empty_command_position_with_leading_operator', () => {
    expect(parseSeq('&& ls')).toBeNull();
  });
  it('rejects_empty_command_position_with_double_separator', () => {
    expect(parseSeq('ls ;; pwd')).toBeNull();
  });
  it('rejects_empty_command_position_with_empty_pipeline_segment', () => {
    expect(parseSeq('ls | | wc')).toBeNull();
  });
  it('parse_zsh_lc_plain_commands', () => {
    // (upstream tests bash.rs parse_shell_lc_plain_commands directly)
    expect(extractBashCommand(['zsh', '-lc', 'ls'])).toEqual(['zsh', 'ls']);
    expect(parseSeq('ls')).toEqual([['ls']]);
  });
  it('accepts_concatenated_flag_and_value', () => {
    expect(parseSeq('rg -n "foo" -g"*.py"')).toEqual([['rg', '-n', 'foo', '-g*.py']]);
  });
  it('accepts_concatenated_flag_with_single_quotes', () => {
    expect(parseSeq("grep -n 'pattern' -g'*.txt'")).toEqual([['grep', '-n', 'pattern', '-g*.txt']]);
  });
  it('rejects_concatenation_with_variable_substitution', () => {
    expect(parseSeq('rg -g"$VAR" pattern')).toBeNull();
    expect(parseSeq('rg -g"${VAR}" pattern')).toBeNull();
  });
  it('rejects_concatenation_with_command_substitution', () => {
    expect(parseSeq('rg -g"$(pwd)" pattern')).toBeNull();
    expect(parseSeq(`rg -g"$(echo '*.py')" pattern`)).toBeNull();
  });
  it('preserves_quoted_literals', () => {
    const cases: Array<[string, string[]]> = [
      ['rg -g"*.py" pattern', ['rg', '-g*.py', 'pattern']],
      [String.raw`echo "\n"`, ['echo', String.raw`\n`]],
      [
        String.raw`echo "~HOME" 'HEAD~1' "HEAD^" 'foo#bar' "=sh" 'file~'`,
        ['echo', '~HOME', 'HEAD~1', 'HEAD^', 'foo#bar', '=sh', 'file~'],
      ],
      [String.raw`echo -"{a,b}" '*?[]~^#=\\'`, ['echo', '-{a,b}', String.raw`*?[]~^#=\\`]],
    ];
    for (const [script, expected] of cases) {
      expect(parseSeq(script), script).toEqual([expected]);
    }
  });
  it('rejects_double_quoted_escapes', () => {
    for (const script of [
      'echo "\\$HOME\\`\\"\\\\\\n"',
      'find . "-de\\\nlete"',
      'echo "\\\\"',
    ]) {
      expect(parseSeq(script), script).toBeNull();
      for (const shell of ['bash', 'zsh']) {
        expect(parseShellLcPlainCommands([shell, '-lc', script]), script).toBeNull();
      }
    }
  });
  it('rejects_runtime_expansion_in_plain_words', () => {
    for (const script of [
      'find . -{delete,print}',
      'rg --pre{=,=sh} pattern payload.sh',
      'find . -del*',
      'find . -delet?',
      'find . -delet[e]',
      String.raw`find . -de\lete`,
      'echo ~',
      'echo ~HOME',
      'echo HEAD~1',
      'echo HEAD^',
      'echo file~',
      'echo =sh',
      'echo foo^bar',
      'echo foo#bar',
      'l* -l',
    ]) {
      for (const shell of ['bash', 'zsh']) {
        for (const flag of ['-c', '-lc']) {
          expect(parseShellLcPlainCommands([shell, flag, script]), script).toBeNull();
        }
      }
    }
  });
});
