# 完整源码重新对照（2026-09-10 下午）

## 0. 先修正我上一轮的错误

昨天上午的 `UPSTREAM-AUDIT-20260910.md` 说「本地上游是稀疏快照，只有 protocol 与 shell-command，**其余 8 个包无法验证**」——**这个结论是错的，是被表象误导了**。

真实情况：`research/upstream/codex` 设了 `core.sparseCheckout=true`（规则只放行 `codex-rs/protocol/` 与 `codex-rs/shell-command/`），**但 `.git` 对象库里有 112,149 个对象**，`git ls-tree HEAD codex-rs/` 列出 **124 个条目**——完整源码一直都在本地，只是没检出到工作树。

用 `git show HEAD:<path>` 可以直接从对象库读取任意文件，**不需要检出、不占磁盘**。本次审计即以此方式读完全部相关 crate。

## 1. 各包与对应上游 crate 的规模实测

统计口径：上游取对应 crate 的 `src/` 下 `.rs`（排除 `tests/` 与 `_tests.rs`）；移植取 `src/` 下 `.ts`（排除 `.test.ts`）。

| 移植包 | 对应上游 crate | 上游行数 | 移植行数 | 占比 |
|---|---|---|---|---|
| codex-policy-engine | shell-command + execpolicy | 8,265 | 3,285 | **39.7%** |
| codex-prompts | prompts + collaboration-mode-templates | 655 | 151 | 23.1% |
| codex-edit-fusion | apply-patch | 4,828 | 341 | **7.1%** |
| codex-config-importer | config | 20,583 | 834 | 4.1% |
| codex-session-kit | rollout + thread-store + file-search + message-history + agent-graph-store + memories | 38,950 | 1,315 | 3.4% |
| codex-skills-kit | ext/skills | 11,704 | 318 | **2.7%** |
| codex-sandbox-bin | linux-sandbox + bwrap + process-hardening + shell-escalation | 9,226 | 90 | 1.0% |
| codex-net-guard | network-proxy | 16,885 | 138 | **0.8%** |
| codex-schema | protocol + history + code-mode-protocol + exec-server-protocol | 33,280 | 9,145 | 27.5%（注） |

注：schema 的 9,145 行分布在 719 个文件里，是**生成的 TS 类型**而非手写移植，行数与上游客观可比性弱，不应按 27.5% 理解成「覆盖四分之一」。

## 2. 三项深入核查

### 2.1 skills selector —— 属实，但是极简近似

- 路线图称移植自 `ext/skills` 的 `dynamic_skill_selector`：✅ **模块真实存在**（`codex-rs/ext/skills/src/dynamic_skill_selector/`），含 `fielded_bm25.rs`(239)、`character_ngram.rs`(243)、`rrf_lexical_char.rs`、`weighted_lexical.rs`(208)、`lru_plus_character_routing.rs` 等。
- 但上游是 **BM25 + 字符 n-gram + RRF 融合 + LRU 缓存 + routing card** 的一整套检索系统（2,000+ 行）。
- 移植 `selector.ts` 只有 **94 行**，取的是其中 `weighted_lexical` 一路的极简近似：
  - 上游权重：`score.saturating_add(256 / 128 / 64 / 24 …)`，且 `short_description` 与 `description` **分开计分**
  - 移植权重：`+3 / +2 / +1 / +1`，只有一个 description 字段
- 移植文件头注释自称 "distillation"，措辞是诚实的；**路线图正文把「+3/+2/+1」当作既有算法陈述，容易读成上游原样**，这是描述精度问题，不是伪造。

### 2.2 edit-fusion —— 7%，且"事务边界"是自创的

- 上游 apply-patch：`lib.rs` 1,444 + `invocation.rs` 1,036 + `streaming_parser.rs` 924 + `parser.rs` 682 + `file_update.rs` 335 ≈ 4,828 行。
- 移植 edit-fusion 共 **341 行**（v4aParser 167 / seekSequence 87 / dsh-plugin 85），**没有**流式解析（streaming_parser）、没有 invocation 处理、没有独立的 file_update 层。
- **关键**：上游 apply-patch 里 `rollback` / `atomic` / `transaction` / `revert` / `restore` **命中 0 处**。路线图所称「patch 级事务边界：任一 hunk/file/move 冲突时回滚整个 patch」**不是移植自上游，而是移植侧自行设计的增强**。增强本身合理（原子性更好），但不能标为"对齐上游"。

### 2.3 policy-engine —— 58% 函数面（昨天已裁决，结论不变）

16 个缺口中：E5 排除 12、已替代 2、已补齐 2（两个薄封装今天已实现）。

## 3. 结论：路线图是不是真的对

**没有发现伪造。** 抽查到的每一条声称，都能在上游找到对应物（parseCommand 106 测试名双向零漂移、dynamic_skill_selector 模块真实存在、apply-patch 确实是被移植的对象）。

**但"已蒸馏 / 已执行"的语义必须重新理解，否则会高估插件能力：**

| 路线图用词 | 实际含义（按本次实测） |
|---|---|
| `distilled` | 保留契约的**简化实现**，不是能力等价 |
| 「已准入能力 100% 有实现」 | 每个条目都有**可运行的蒸馏件**，但覆盖上游代码量的 0.8%–40% |
| parseCommand「1:1 对齐」 | 仅在 shell-command crate 内的 **106 个测试**维度成立 |

一句话：**路线图对自己做过的事记录属实，但"完成度"的口径是"有蒸馏件"，不是"与上游等价"。** 按代码量看，除 policy-engine（39.7%）与 prompts（23.1%）外，其余包都在 10% 以下。

## 4. 插件还要不要改

要改不改，取决于目标，而不是取决于"有没有差距"：

- **如果目标是 DSH 侧可用**（当前定位：只注册 `codex_policy_check` / `codex_command_safety_check` 两个工具）——现状够用，不必补齐。
- **如果要声称"与上游等价"**——差距很大，尤其 edit-fusion（缺流式解析）、skills（检索质量差一个量级）、net-guard（0.8%）、sandbox-bin（1.0%）。
- **如果要接 exec 消费面**——需要 policy-engine 那 12 个被排除的函数（shell 探测 / 状态快照），重启条件已写入路线图第十节。

## 5. 建议

1. **在路线图与 README 里把 `distilled` 的定义写实**，并附本次的规模对比表，避免"100% 有实现"被读成"100% 等价"（`91e76d5` 已经在做这类诚实化，可延续到路线图）。
2. **edit-fusion 的"事务边界"改标为「移植侧增强」**，与上游对齐的部分另列。
3. **skills selector 的注释保持 distillation 措辞**，路线图正文补一句权重为自定（上游是 256/128/64/24）。
4. 本仓的 `research/upstream/codex` 是稀疏检出，**审计时不要只看工作树**——用 `git ls-tree` 看全量、`git show HEAD:<path>` 读文件。


## 6. 附：edit-fusion 的端到端等价性实测（2026-09-10 晚）

规模对比只能说明"移植了多少"，说明不了"行为是否一致"。本节用上游 **25 个端到端场景**（`apply-patch/tests/fixtures/scenarios/`，每个含 `input/` + `patch.txt` + `expected/`）直接驱动移植实现，与 `expected/` 逐文件比对。

**结果：12/25 → 22/25。**

### 修掉的 4 个真实差距

| 场景 | 差异 | 处理 |
|---|---|---|
| 017 / 018 / 020 | 上游容忍标记与指令行前后的空白，移植一律拒绝 | 指令行 trim 后判定；**body 行绝不 trim**（`+`/`-`/空格是数据） |
| 005 | 空 patch（无任何操作）上游拒绝，移植接受 | 解析后无操作即抛错 |
| 001 / 002 / 016 | 上游结果文件以换行结尾，移植可能不加 | 应用后保证换行结尾（否则 git 报 `\ No newline at end of file`） |
| 016 | 纯添加 hunk 多插一个空行 | 内容按尾换行 split 后末尾是空串，`base` 改用它之前的位置 |

第三项**改变了既有契约**：3 条断言原本期望无尾换行，已随行为一并更新。

### 保留的 3 个有意偏离（测试里钉住并注明理由）

| 场景 | 上游 | 我们 |
|---|---|---|
| 010 / 011 | move / add 允许覆盖已存在目标 | **拒绝覆盖**（防误删，且被既有测试钉住） |
| 015 | 失败时保留此前已成功的改动 | **整 patch 回滚**（移植侧自创的原子性，不"修"回上游） |

### 固化

场景已入库为 `codex-edit-fusion/test/fixtures/upstream-scenarios/`（25 场景 / 81 文件），由 `test/upstreamScenarios.test.ts` 驱动。此后任何人改动 edit-fusion，等价性变化都会在测试里显形。

### 当前遗留的一个红（与本节改动无关）

`dsh-codex-pack/test/loader.integration.test.ts` 期望 11 个工具、实际 10 个，缺 `codex_apply_patch`。根因：并行会话把 edit-fusion 重构为依赖真实 DSH API，`inject` 由 `["tools"]` 变为 `["tools","fs"]`，而 loader 测试只 `provide('tools')`，插件因依赖未满足而不激活。

修法是让该测试同时提供 `fs`（pack 侧需引入 `@deepseek-ai/dsh-fs`）。本机无外网无法安装验证，且 `fs` 服务的正确来源属于在途设计决策，故未擅自动手。**这是当前唯一一个红的测试，且不是本节改动引入的。**


## 6. 附：edit-fusion 的端到端等价性实测（2026-09-10 晚）

规模对比只能说明"移植了多少"，说明不了"行为是否一致"。本节用上游 **25 个端到端场景**（`apply-patch/tests/fixtures/scenarios/`，每个含 `input/` + `patch.txt` + `expected/`）直接驱动移植实现，与 `expected/` 逐文件比对。

**结果：12/25 → 22/25。**

### 修掉的 4 个真实差距

| 场景 | 差异 | 处理 |
|---|---|---|
| 017 / 018 / 020 | 上游容忍标记与指令行前后的空白，移植一律拒绝 | 指令行 trim 后判定；**body 行绝不 trim**（`+`/`-`/空格是数据） |
| 005 | 空 patch（无任何操作）上游拒绝，移植接受 | 解析后无操作即抛错 |
| 001 / 002 / 016 | 上游结果文件以换行结尾，移植可能不加 | 应用后保证换行结尾（否则 git 报 `\ No newline at end of file`） |
| 016 | 纯添加 hunk 多插一个空行 | 内容按尾换行 split 后末尾是空串，`base` 改用它之前的位置 |

第三项**改变了既有契约**：3 条断言原本期望无尾换行，已随行为一并更新。

### 保留的 3 个有意偏离（测试里钉住并注明理由）

| 场景 | 上游 | 我们 |
|---|---|---|
| 010 / 011 | move / add 允许覆盖已存在目标 | **拒绝覆盖**（防误删，且被既有测试钉住） |
| 015 | 失败时保留此前已成功的改动 | **整 patch 回滚**（移植侧自创的原子性，不"修"回上游） |

### 固化

场景已入库为 `codex-edit-fusion/test/fixtures/upstream-scenarios/`（25 场景 / 81 文件），由 `test/upstreamScenarios.test.ts` 驱动。此后任何人改动 edit-fusion，等价性变化都会在测试里显形。

### 当前遗留的一个红（与本节改动无关）

`dsh-codex-pack/test/loader.integration.test.ts` 期望 11 个工具、实际 10 个，缺 `codex_apply_patch`。根因：并行会话把 edit-fusion 重构为依赖真实 DSH API，`inject` 由 `["tools"]` 变为 `["tools","fs"]`，而 loader 测试只 `provide('tools')`，插件因依赖未满足而不激活。

修法是让该测试同时提供 `fs`（pack 侧需引入 `@deepseek-ai/dsh-fs`）。本机无外网无法安装验证，且 `fs` 服务的正确来源属于在途设计决策，故未擅自动手。**这是当前唯一一个红的测试，且不是本节改动引入的。**
