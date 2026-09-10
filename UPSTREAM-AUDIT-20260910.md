# 上游源码对照审计（2026-09-10）

回答两个问题：路线图里那些「已执行 / 已闭环」是否站得住；插件是否还需要修改。

## 0. 先说硬限制：本次能验什么

| 项 | 实测值 |
|---|---|
| 上游本地 checkout | `research/upstream/codex`，HEAD = `121f91fd5` |
| 相对 remote | **behind 29**（remote `adee0b0`） |
| 上游快照完整性 | **稀疏**：`codex-rs/` 下只有 `protocol/` 与 `shell-command/` 两个 crate |
| 网络 | 无外网，无法 fetch 补齐 |

**因此：10 个包里只有 `codex-policy-engine`（对照 shell-command）能逐项验证，`codex-schema` 只能做有限对照，其余 8 个包根本没有可对照的上游源码。** 下面严格区分「实证」与「无法验证」。

---

## 1. 可验证部分：policy-engine ↔ 上游 shell-command crate

### 1.1 站得住的部分（实证）

**测试名覆盖**：脚本实测提取上游 `parse_command.rs` 的 83 个 `#[test]` + `bash.rs` 的 23 个 = **106**；移植 `test/parseCommand.test.ts` 的 `it()` 名 **106**；双向差集均为 **0**。路线图说的「1:1 对齐、双向零漂移」是真的。

**断言抽查**（名字对齐不等于语义对齐，所以逐条比了断言内容）：

| 测试 | 上游 | 移植 |
|---|---|---|
| `bash_cd_then_cat_is_read` | `Read { cmd: "cat foo.txt", name: "foo.txt", path: "foo/foo.txt" }` | `RD('cat foo.txt', 'foo.txt', 'foo/foo.txt')` |
| `awk_behavior` | `awk '{print $1}'`→true；带文件名→false；`awk -f script.awk`→false | 三条完全一致 |

### 1.2 站不住的部分（实证）

**函数面覆盖率只有约 58%。** 上游 shell-command crate 共 **38 个 pub fn**，移植未见对应导出的有 **16 个**：

| 上游文件 | 缺失函数 | 性质 |
|---|---|---|
| `shell_detect.rs`（7 个中缺 5） | `default_user_shell`、`default_user_shell_from_path`、`get_shell`、`get_shell_by_model_provided_path`、`ultimate_fallback_shell`、`fallback_powershell_shell_for_elevated_windows_sandbox` | 探测本机默认 shell 环境 |
| `shell_snapshot.rs`（2/2 全缺） | `snapshot_script`、`snapshot_state_and_environment_script` | 跨命令保持 cd/export 的 shell 状态快照 |
| `command_safety/powershell_parser.rs` + `powershell_tree_sitter.rs`（2/2 全缺） | `try_parse_powershell_ast_commands`、`try_parse_powershell_commands` | PowerShell 的 AST 级解析公开入口 |
| `command_safety/is_dangerous_command.rs`（缺 2） | `dangerous_command_match_for_platform`、`dangerous_powershell_words_match` | 平台化危险命令判定 |
| `bash.rs`（缺 3） | `try_parse_shell`、`try_parse_word_only`、`parse_shell_lc_literal_commands` | bash 词序列解析（后者路线图已承认未按名移植） |
| `powershell.rs`（缺 1） | `prefix_powershell_script_with_utf8` | 脚本 UTF-8 前缀 |

已确认有对应的（避免误判）：`parse_command.rs` 的 7 个、`windows_dangerous_commands.rs` 的 2 个（`isDangerousCommandWindows` / `isDangerousPowershellWords` 在 `commandSafety.ts`）、`powershell.rs` 的 3 个（在 `powershellLowering.ts`）。

### 1.3 路线图的一处描述错误

路线图 P1-1 称「**shell_detect 提权选路**已执行（`detectEscalation`）」。实测上游 `shell_detect.rs` 的 7 个 pub fn 全是 shell 类型/路径探测，**没有提权相关函数**；`detectEscalation` 实际由 `commandSafety.ts` 提供，对应的是 parse_command 里的 sudo/doas 处理。功能存在，但归属写错了——照路线图去找上游会对不上。

---

## 2. 有限可验：schema ↔ 上游 protocol crate

- 上游 `protocol` crate 共 **27,270 行**（`protocol.rs` 6,291 / `permissions.rs` 4,486 / `models.rs` 4,400 / `openai_models.rs` 2,092）；移植 `handwritten/protocol` 只有 **122 行**（types 49 + validate 73）。这是「蒸馏」定位，行数差异本身不等于缺陷。
- 但上游 protocol crate 里**没有** `history.rs`、`exec_server.rs`、`codemode.rs`（这些可能在其他 crate，本地快照缺失）→ 移植的 history / exec-server-protocol / code-mode-protocol 三个面**无法验证其上游来源是否真实存在**。
- 上游最大的 `permissions.rs` / `models.rs` / `openai_models.rs` 移植无对应。是否有 DSH 消费面、应否移植，需要一次明确裁决（当前既没移植也没记录排除理由）。

---

## 3. 无法验证的部分（诚实清单）

以下包**没有本地上游源码可对照**，本次不能证明其对错：

`codex-skills-kit`（selector 别名/打分）、`codex-edit-fusion`（apply-patch）、`codex-config-importer`（tomlImporter）、`codex-session-kit`（sessionIndex / threadStore / rolloutMetrics）、`dsh-codex-pack`（profileWriter）、`codex-net-guard`、`codex-prompts`、`codex-sandbox-bin`。

**其中 skills-kit 的 selector 最需要补证据**：路线图称它移植自 `ext/skills` 的 `dynamic_skill_selector`，并给出了具体打分规则（名/别名命中 +3、名内词 +2、描述词 +1、前缀重叠 +1）。实测本地上游快照 `find -iname "*skill*"` **返回空**——这条声称目前**没有任何可溯源证据**，既不证实也不证伪。

---

## 4. 结论：插件还要不要改

**不能确定「不用再改」。** 分三层看：

1. **已验证部分是扎实的**：parseCommand 的 106 条逐名逐断言对齐，不是抄名字充数。
2. **但覆盖面只有约 58%**，且缺口在路线图里**从未被记录或裁决**——不是「评估后决定不移植」，而是「没看过」。16 个缺口集中在**真实执行 shell 命令**的场景：探测本机 shell（5）、shell 状态快照（2）、PowerShell AST 解析（2）、平台化危险判定（2）。
3. **90% 的移植件无法验证**，因为本地上游是稀疏快照且落后 29 个提交。

一个补充事实：插件实际只注册 **2 个 dsh 工具**（`codex_policy_check`、`codex_command_safety_check`），移植面主要作为库导出。所以上述缺口**当前不影响已接线的功能**；只有当 DSH 侧要真正执行 shell 命令时，shell 探测与状态快照才会变成硬需求。

## 5. 建议（按优先级）

1. **补齐上游快照**（有网时完整 clone + fetch 到 `adee0b0`）。这是前提——否则其余 8 个包永远无法审计，路线图里的「已执行」只能靠自证。
2. **把 16 个函数缺口做成裁决表**：逐条写明「移植」或「E5 排除 + 理由」。当前状态是留白，不是裁决。
3. **修正路线图**中「shell_detect 提权选路」的归属描述。
4. **给 skills selector 补证据**：它是唯一一条给出了具体算法却完全无法溯源的声称。
