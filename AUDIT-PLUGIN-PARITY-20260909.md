# 插件 vs 上游 codex 源码：独立对等性核验

日期：2026-09-09 23:20
核验对象：`dsh-codex-monorepo` 各包 ↔ `research/upstream/codex`（openai/codex @ `121f91f`）

> 这份核验**不引用路线图的任何自证结论**。路线图里的「✅ 已执行 / distilled / 100% 有实现」是此前各轮的自我陈述，本次只认源码比对与实测输出。

---

## 1. 结论先说

**插件还需要修改。** 拿上游源码对照 + 实际调用验证后，发现了**一条三层递进的安全缺陷链**，其中前两层已修（`166eefb`），第三层是根因、尚未修。

路线图里 P1-1 写的「shell-command / policy-engine ✅ 已全部执行」**与实测不符**：在 DSH 实际使用的入口上，包装命令的危险检测是失效的。

## 2. 上游素材的可信边界（先说清楚能验什么）

| 项 | 实测 |
|---|---|
| 本地上游 checkout | `121f91f`，相对 `origin/main` **behind 29** |
| 本地快照完整度 | **稀疏**：`codex-rs/` 只有 12 个条目（含 `shell-command`、`protocol`、`Cargo.toml` 等）；完整上游是 **149 crates** |
| 因此可硬对照的 | 只有 **`shell-command`**（6,510 行）与 `protocol` |
| 无法在本机核验的 | 其余 147 个 crate 的移植忠实度——路线图里那些「已蒸馏」结论，本机没有源码可证，只能存疑 |

也就是说：**本机只能负责任地对 shell-command 这一块下结论**，其他模块的"忠实移植"属于未经本次验证的既有陈述。

## 3. 规模对照（shell-command）

| 上游文件 | 行数 | 插件对应 | 行数 |
|---|---|---|---|
| `parse_command.rs` | 2,766 | `parseCommand/parseCommand.ts` 等 | 1,537 |
| `windows_dangerous_commands.rs` | 771 | `commandSafety.ts`（部分） | 437 |
| `bash.rs` | 565 | `bashWordSeq.ts` | 237 |
| `shell_detect.rs` | 495 | `shellDetect.ts` | 36 |
| `powershell_tree_sitter.rs` + `powershell_parser.rs` + `powershell.rs` | 1,146 | `powershellExtract.ts` | 25 |
| `is_dangerous_command.rs` | 323 | `commandSafety.ts` | (同上) |
| `shell_snapshot.rs` | 225 | — | — |

规模差距本身不构成缺陷（不是所有面都需要移植），但它指明了该往哪儿查。

## 4. 发现的三层缺陷

### 第 1 层：Line 入口把包装脚本体拆散 → 只看第一个 token

`dangerousCommandMatchLine` 先 `shellSubCommands` + `shlexSplit`，`-c` 后的脚本体变成多个 argv 元素；而 `matchWithDepth` 只取 `command[flagIdx + 1]`：

```
shellSubCommands('pwsh -Command "Remove-Item test -Force"')
  => ["pwsh -Command Remove-Item test -Force"]     ← 引号已剥掉
shlexSplit        => ["pwsh","-Command","Remove-Item","test","-Force"]
matchWithDepth   => 只把 "Remove-Item" 当脚本体 → 漏检
```

### 第 2 层：Windows shell 分支的「-Command 后必须恰好一个参数」约束

`isPowershellInvocationArgs` 里 `if (idx + 2 !== args.length) return null` —— 拆散形态下必然不满足，直接返回 null，**整个危险词检测被跳过**。

### 实测：DSH 实际入口（修复前）

`dsh-plugin.ts:225` 与 `:280` 用的正是 `dangerousCommandMatchLine`，所以这些都**实际可利用**：

| 命令行 | 修复前 | 修复后 |
|---|---|---|
| `sh -c "rm -rf /"` | ok（漏检） | **ForcedRm** |
| `bash -c "rm -rf /"` | ok（漏检） | **ForcedRm** |
| `zsh -c "rm -rf /"` | ok（漏检） | **ForcedRm** |
| `powershell -Command "Remove-Item test -Force"` | ok（漏检） | **Other** |
| `pwsh -c "Remove-Item -Force"` | ok（漏检） | **Other** |
| `powershell -NoProfile -Command "Remove-Item -Force"` | ok（漏检） | **Other** |
| 对照 `rm -rf /`（裸命令） | ForcedRm | ForcedRm |
| 对照 `echo $(rm -rf /)` | ForcedRm | ForcedRm |
| 良性 `sh -c "echo hi"` | ok | ok（无误报） |

同一个命令以 argv 数组交给 `dangerousCommandMatch` 时是 DANGEROUS，走 Line 入口就放行 —— 两个入口行为不一致，本身就是缺陷的信号。

### 第 3 层（根因，**未修**）：用 POSIX shlex 解析 Windows shell 脚本体

`isPowershellInvocationArgs` 拿到脚本体后调用 `shlexSplit`（POSIX 语义），而 Windows 路径里的 `\` 是普通字符、不是转义符：

```
shlexSplit('Remove-Item -Recurse -Force C:\')      => null        ← 解析失败，危险检测彻底静默
shlexSplit('Remove-Item -Recurse -Force C:\Windows') => [..., "C:Windows"]   ← 反斜杠被吃掉
shlexSplit('Get-Content C:\tmp\x')                  => ["Get-Content","C:tmpx"]  ← 路径被毁
```

后果：**`powershell -Command "Remove-Item -Recurse -Force C:\"` 仍被判为安全**（最典型的破坏性命令反而漏检）。上游用 1,146 行的专用解析器处理这一面，插件只移植了 25 行的 `extract_powershell_command`。

**修复需要**：一个 Windows shell 感知的分词器（反斜杠非转义、单引号内 `''` 转义、双引号内反引号转义、管道/分号分段）。这不是顺手改，要对着上游 `command_safety/fixtures/powershell_lowering.json` 的 68 条基准用例做。

## 5. 本次改动

`166eefb` — 修第 1、2 层：

- `matchWithDepth`：`command.slice(flagIdx + 1).join(' ')` 作为脚本体（单参数形态 join 后等价自身，无行为变化）。
- `isPowershellInvocationArgs`：去掉「恰好一个参数」约束，改为 `args.slice(idx + 1).join(' ')`。
- 新增 `test/wrapperRegression.test.ts`（6 条），覆盖单参数/拆散/Line 入口/别名/前置 flag/良性对照。
- 重建 `codex-policy-engine/lib/index.js`。

**验证**：policy-engine **11 文件 / 171 测试全绿**（原 165 + 新增 6，无回归）；10 包 bundle check 除并行会话正在改的 dsh-codex-pack 外均 0 drift。

## 6. 对路线图可信度的判断

| 路线图说法 | 本次核验 |
|---|---|
| P1-1「shell-command / policy-engine ✅ 已全部执行」 | **不符**。移植了 1,537 行 parse_command 且 106 测试对齐是真的，但**命令安全分类在 DSH 实际入口上是失效的**，且从未被测试覆盖 |
| 「上游 29 提交审计已闭环」 | 上游 behind 29 属实（已复核）；但审计结论本身本机无完整源码可验（稀疏快照） |
| 「100% 已准入能力有可运行实现」 | 无法在本机证伪或证实——本地快照只有 2 个可对照 crate |

**判断**：路线图的问题不是造假，而是**验证口径偏窄**——测试对齐了移植模块的内部行为（106 条 parse_command 测试），却没有人从"DSH 实际怎么调用"这一端跑过一遍。这次的缺陷就藏在这个缝里。

## 7. 建议的下一步（按价值排序）

1. **补第 3 层**：实现 Windows shell 感知分词器，用上游 68 条 `powershell_lowering.json` 基准用例验收（当前这些用例一条都没被插件测试引用）。
2. **从调用端补 E2E 测试**：以 `dsh-plugin` 的 `codex_command_safety_check` 工具为入口，对包装命令矩阵做断言，而不是只测内部函数。
3. **补齐其他 147 个 crate 的核验**：需要完整上游源码（本机稀疏快照 + 无外网），建议在有网环境做一次全量 `verify_coverage` 再下结论。

## 8. 备注：并行会话正在进行中

核验期间另一会话正在改 `dsh-codex-pack`（`src/index.ts`、`preflight.ts`、`profileWriter.ts`、`manifest.json`、`cordis.patch.yml` 等 8 个文件有未提交改动），且其 `lib/index.js` 尚未重建（所以 bundle check 报它 stale）。本次未介入这些改动。
