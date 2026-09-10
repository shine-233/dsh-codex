# codex→dsh 移植套件 · 下一阶段路线图（2026-09-07 对账 + 续作）

> 前序文档：`ROADMAP-2026-09-06.md`（同日已执行五轮）。本文档在对账复核基础上，给出「39 条设计收割」是否仍属实的结论，并固化下一阶段执行清单。
>
> 审计铁律（沿用）：数字必须可溯源；测试缺陷与程序缺陷必须区分；**不得**为凑进度伪造 design-only→distilled 的判定。

---

## 一、历史结论与 2026-09-10 证据纠偏

2026-09-07 时，台账从“39 条仅设计收割”推进到 **0 active design-only**，这个迁移清单事实仍成立；但当时把“有代码、有单元测试”写成“已准入能力 100% 有可运行实现”，容易被理解为已完成 DSH 运行时等效。后续逐条 consumer/host 审查证明，这个推论不成立。

| 口径 | 2026-09-10 复核结论 |
|---|---|
| 迁移标签 | 153 个时序 row：7 implemented / 46 distilled / 100 EXCLUDED（只表示去向） |
| 53 条正向记录 | **0 runtime-equivalent / 9 behavioral-subset / 6 structural-only / 37 implemented-unconsumed / 1 unsupported-overclaim** |
| 100 条当前排除记录 | 原 97-row 首轮 78/1/18 已失效；exact-source 已 **100/100** 裁决为 **37 split / 13 blocked / 38 excluded / 12 migration-candidate** |
| 时序完整性 | historical anchor **142 manifests**、`adee0b0` **151 manifests** 均已通过 revision-aware exact-set gate；153-row 台账保留 2 个已删除历史 crate，并登记 3 个 endpoint 新增 crate |
| 完成度百分比 | 撤回此前基于标签的 85%–90% 或 100% 表述；范围和权重未定义前不再给百分比 |

逐条证据见 `dsh-codex-ledger/EVIDENCE_AUDIT_20260910.md`。四个关键反例已经由当前 DSH host 源码确认：rollout 未持久化/恢复为合法 Session，apply-patch 绕过 DSH FS authority，subagent roster 未进入真实 prompt assembly，config importer 未写当前 settings/default-model/provider。聚合包也只证明 source-tree sibling activation，不证明 registry 或单 tarball 闭包。

以下 2026-09-07 执行记录作为历史保留；其中“implemented/distilled”不得再读作 crate-level 或 runtime equivalence。

---

## 二、本轮回合（2026-09-07）已执行的实作

1. **修复 1 个真实程序缺陷**（验证中暴露，非测试缺陷）：
   - `codex-config-importer/src/utils/pathUri.ts` 的 `uriToPath` 在 win32 下对**所有**路径盲目反斜杠化，导致 POSIX 路径 `/home/u/x.txt` 被错误转成 `\home\u\x.txt`。已改为仅对 Windows 盘符式路径做反斜杠化，POSIX 路径保留正斜杠。
   - 证据：修复前 config-importer `17 passed / 1 failed` → 修复后 `18 passed / 0 failed`。
2. **台账诚实化（7 条 design-only 收口）**：
   - 3 条 sandbox-bin（bwrap/process-hardening/shell-escalation）改判 `EXCLUDED/E5-vendor-binary`，audit 注明「二进制即实现、无 JS 面」。
   - 4 条早已改判 EXCLUDED/E5 但遗留 `status: design-only` 标记的（core-plugins/exec-server/plugin/utils-plugins）清除遗留标记。
   - 结果：`coverage.yaml` 中 `status: design-only` 计数从 7 → **0**。
3. **全量回归**：10 包 211 测试全绿（实测逐包输出，非摘要背书）。

4. **P0-1 已执行（session-kit SessionIndex 本地可验证）**：原 `SessionIndex` 强依赖 `node:sqlite`，本环境该扩展存在（experimental）但测试以「node:sqlite unavailable; skipping」静默跳过 → 会话镜像**实测从未覆盖**。重构为可插拔存储：优先 `SqliteSessionStore`（node:sqlite，新增 `close()` 释放句柄避免 Windows 下 `rmSync` 报 `EBUSY`），不可用时回退 `JsSessionStore`（纯内存）。测试去掉 skip 闸后**真实跑通**，并暴露/修复了 sqlite 连接未关闭导致的 `EBUSY` 锁文件问题。证据：修复前该用例 skip（0 覆盖）→ 修复后 `27 passed / 0 failed`（session-kit 全绿，无 skip）。

5. **P1-2 已执行（ext/skills `dynamic_skill_selector`）**：上游别名选择算法此前在蒸馏面外（`ext/skills` 条目 `code: PARTIAL`、台账头注释亦称「别名选择逻辑不在蒸馏面内」）。本轮新增 `codex-skills-kit/src/selector.ts`：`normalizeToken` / `buildAliasIndex` / `resolveAlias`（别名→规范名解析，含前缀/包含回退）/ `selectSkills`（词法打分：名/别名命中 +3、名内词 +2、描述词 +1、名前缀重叠 +1；按分数降序、同名按名称升序确定性排序）。并注册 `codex_skill_select` dsh 工具（注入缝，与 catalog/executor 同构）。新增 `test/selector.test.ts`（11 测试）。证据：skills-kit `21 passed / 0 failed`（5 budget + 5 executor + 11 selector）；全量 10 包 `224 passed / 0 failed`（较 P1-1 后 213 + 11）。台账 `ext/skills` 改判 `code: distilled`，头注释同步更新。

6. **P1-3 已执行（rollout 持久化度量）**：新增 `codex-session-kit/src/rolloutMetrics.ts`：`rolloutPersistenceMetrics(dir)` 扫描会话目录，回报 total / uncompressed / compressed / totalBytes / uncompressedBytes / compressedBytes / savedBytes / savedPct / ordinal / persisted——ordinal = 已持久化 rollout 代数（单调序），压缩节省通过对 `.gz` 重建原始载荷实测（损坏 gz 降级按存储字节计，`savedBytes` 恒 ≥0）。新增 `test/rolloutMetrics.test.ts`（3 测试：空目录归零 / 压缩后实测节省 / 混合目录含非 rollout 文件忽略）。
7. **P1-4 已执行（thread-store 持久后端）**：`threadStore.ts` 新增 `JsonlFileThreadStore`（线程写 `<file>`、队列写 `<file>.queue.jsonl`，构造即重建 → 新实例=新进程可见同状态；`drainQueue` 自身落盘化；坏行容忍）+ `createThreadStore` 工厂（传 file → durable，缺省内存）。新增 `test/threadStore.test.ts`（4 测试：内存回路 / 跨实例 reopen 持久 / 坏行容忍 / 工厂选择）。证据：session-kit `34 passed / 0 failed`（27 → +3 +4）。

8. **环境事件与测试加固（skills-kit `executor.test.ts`）**：本轮实跑中发现 sandbox 的 safe-delete 助手 `genie-trash\win32-x64.exe` 对 **repo 本地路径删除系统性挂起**（`spawnSync ... ETIMEDOUT`；7 字节探针文件同样复现，而 `os.tmpdir()` 路径 1ms 直删豁免——两例隔离实测）。`executor.test.ts` 原以 `rmSync(__dirname/fixtures-skills)` 重置仓库内 fixture，正踩中该路径 → beforeAll 抛错、5 用例 skip（16 passed / 5 skipped，复现 2 次）。加固：fixture 改 `mkdtempSync(tmpdir())` 每轮新建 + `afterAll` 清理（与 session-kit 同模式），陈旧 `fixtures-skills/`（gitignored）已 mv 至系统临时目录非破坏性移出。**定性：测试健壮性缺陷 + 环境助手故障，非程序缺陷**；CI per-package 工作流无此 shim 不受影响。修复后 skills-kit 21/21 绿。

9. **全量回归（终态）**：10 包 **231 passed / 0 failed**——config-importer 18 / edit-fusion 10 / net-guard 3 / policy-engine 45 / prompts 6 / sandbox-bin 4 / schema 17 / session-kit 34 / skills-kit 21 / dsh-codex-pack 73（逐包 vitest 实测输出求和；P1-2 后 224 → +7）。注：多包循环 sweep 会话中被 SIGTERM 中断 3 次，已改逐包/并行单跑取证。

10. **P0-2 已执行（linux-sandbox 处置裁决）**：正式**冻结 vendor 0.149**——实测 `bin/linux-x64/codex-linux-sandbox` = 49,198,120 bytes，sha256 冻结基线 `d77ef2bf03d275b30381456d2efc07458e3db38756b796470c3cf201223b3a14`（写入台账 audit）；上游 0.153.4 release 已不附带该资产，无新版可跟进；本沙箱无 Rust/musl 工具链与网络，不伪造自建。显式重启条件：①具备 Rust/musl 环境按 `BUILD.md`（`cargo build --release -p codex-linux-sandbox`）自建，②上游恢复附带资产；重建产物必须与冻结基线 hash 比对。Windows 侧维持 2026-09-06 刷新的 0.153.4 时代二进制。该二进制为 `sandboxSummary.ts:18` 运行时引用，不可移除。

11. **P2-2 已执行（schema 五面 validator zod 形式化）**：新增共享 `handwritten/zodUnion.ts`（tag 分发适配器原样保留 sketch 语义：non-object→variant null、非字符串 tag→missing string、未知 tag→variant=tag；`sketchMember`/`presenceKeys` 字段糖）。五面 validate.ts（extension-api / history / protocol / exec-server-protocol / code-mode-protocol，15 个 validateXxx）字段校验全部转 zod schema。方法：**先写 `test/validatorSemantics.test.ts`（17 测试）对旧守卫钉死 ok/variant/type 契约（含未断言角落：未知 tag 的 variant 标记、显式 undefined 键、数组非对象、null 拒收），再重写**；重写暴露并修复 1 处 zod 语义差（zod parse 丢弃显式 undefined 值键 → `presenceKeys` 改 `z.custom` 直测原始输入）。证据：schema **34/34 绿**（原 4 个契约测试文件零改动 + 语义锁 17）；全量 10 包 **248 passed / 0 failed**（231 + 17）。

11b. **typecheck 打通与 types.ts 审计（同日续）**：网络通路确认后以 standalone TS 5.x 工具链（`~/.workbuddy/binaries/node/workspace`，不污染仓库 lockfile）跑通 `tsc --noEmit`——先修掉重写引入的 4 处 `ValidationResult` 导入冲突（TS2440），**全包 0 错误**。随后临时摘除 4 个 types.ts 的 `@ts-nocheck` 审计欠账：**366 处类型错误**（TS2304 缺失引用类型 WireCellId/CellId/ToolName 等 + TS2300 重复成员 + TS2686）——机械翻译的结构性缺陷，修复等价于按上游形状重写类型层 → 定性为后续 epic（需上游 codex 源码对照，网络已可用），本轮维持 pragma 不动。

> **2026-09-07 清单执行记录（非运行时等效结论）**：P0-1/P0-2/P1-1/P1-2/P1-3/P1-4/P2-2 当时均有对应代码或机器证据；P2-1/P2-3/P2-4 维持产品/环境决策类原状。2026-09-10 的逐条审查已取代“全部收口”结论：没有正向记录达到 `runtime-equivalent`，且五个 host/package 硬门仍未闭环。

---

## 三、仍存在的「真实」工作（按优先级）

### 2026-09-07 续作：配置导入器第一刀已落地

- `codex-config-importer/src/tomlImporter.ts` 不再按逗号/引号做脆弱字符串切分：现在支持字符串内逗号和 `#`、基本转义、科学计数法、嵌套数组与 inline table，并继续保持未知/未映射键可读而不影响 patch 生成。
- 新增 3 个回归用例，导入器测试从 18 增至 **21 passed / 0 failed**；同步重建 `lib/index.js`，避免 dsh 通过 package exports 继续执行旧实现。
- 脱敏真实形状 fixture 已覆盖多行基本字符串（含字符串内 `#`）、日期样式原文保留、嵌套 provider table 与两个 `[[mcp_servers]]` 数组表；`stripComment` 不再因某一物理行的注释截断后续多行值。
- 包 README 自初始版本就把 `parseTomlLite` 列为独立库公共 API，但历史 bundle 漏导出；现由 `src/dsh-plugin.ts` 显式重导出并让测试从该 package 入口取用。重建 bundle 后 public-export smoke 已同时验证 `apply` / `parseTomlLite` / `tomlToCordisPatch` 以及注册工具与直接 helper 输出一致。
- 边界仍明确：这不是完整 TOML 1.0 解析器；日期/时间仍按原文保留，多行字面字符串、quoted dotted keys 与完整日期语义尚未覆盖。bare dotted keys 已按上游真实 `model_providers.<id>.auth.timeout_ms` 路径落地，并阻断原型污染路径；继续扩展仍必须由脱敏真实配置形状驱动。

下面这些**不是** design-only，而是「已蒸馏但部分子面未移植」或「环境/产品决策类」缺口。它们才是下一阶段该啃的硬骨头。

### P0 · 立即可做、可验证
| # | 项 | 现状 | 动作 |
|---|---|---|---|
| P0-1 | **session-kit SessionIndex 在本环境不可验证** | `node:sqlite` 未编入当前 Node 22.22.2，`rebuilds and searches` 测试 `node:sqlite unavailable; skipping` → 会话镜像**实测未覆盖** | **✅ 已执行（见二.4）**：重构为可插拔存储 + 纯 JS 回退 + `close()` 释放 sqlite 句柄，测试去掉 skip 后真实跑通 |
| P0-2 | **linux-sandbox musl 自建** | ✅ **已执行（2026-09-07）**：处置 = **正式冻结 vendor 0.149**（二进制实测 49,198,120 bytes / sha256 冻结基线 `d77ef2bf…b3a14` 已记台账；上游 0.153.4 不再附带资产，无新版可跟进；本沙箱无 Rust/musl 工具链与网络，不伪造自建）。重启条件 ①具备 Rust/musl 环境按 BUILD.md 自建 ②上游恢复附带资产；重建须与基线 hash 比对。Windows 侧维持 09-06 刷新的 0.153.4 时代二进制 | 待有 Rust/musl 构建环境时自建，或正式声明停更 vendor（0.149）并写入台账 |

### P1 · 深化部分蒸馏（需立项，中等工作量）
| # | 项 | 未移植子面 | 价值 |
|---|---|---|---|
| P1-1 | **shell-command / policy-engine** | `parse_command` 全量 bash 文法 + `shell_detect` 提权选路 | ✅ **已全部执行（2026-09-07 续）**：①提权选路 `commandSafety.detectEscalation`（sudo/doas/pkexec/gsudo/elevate/runas + su -c，含选项参数跳过），+2 测试。②**`parse_command` 全量 bash 文法已落地**——缓议前提（无上游 rust 源码）因网络通路解除，取 rust-v0.153.4 上游 `parse_command.rs`(2,766 行) + `bash.rs`(565 行) 逐条移植：新增 `codex-policy-engine/src/parseCommand/{shlex,bashWordSeq,shellDetect,powershellExtract,parseCommand}.ts` 共 **1,537 行** + `test/parseCommand.test.ts` **625 行 / 106 测试**，与上游 83+23 测试名 **1:1 对齐（双向 comm diff 零漂移）**；6 个高危引号字面量按码点与上游原文**逐字节校验**；`shlex` 为 shlex-1.3.0 忠实移植（quote/split 算法按 crates.io 源码核对）。证据：policy-engine **45 → 151 全绿**。遗留（已写入模块头注释）：8 个 tree-sitter 节点遍历内部函数无对应物（手写词法器替代）；`parse_shell_lc_literal_commands` 未按名移植，其消费路径由 `commandSafety.splitInvocationSegments` 承担（行为等价近似，非节点级忠实）。同日去重：`commandSafety.shlexSplit` 复用忠实移植版，消除包内双 shlex 实现漂移 |
| P1-2 | **ext/skills dynamic_skill_selector** | ✅ **已执行（2026-09-07）**：`selectSkills`/`resolveAlias`/`buildAliasIndex`/`normalizeToken` 别名解析+词法打分蒸馏落地，+11 测试，skills-kit 21/21 绿；注册 `codex_skill_select` dsh 工具（注入缝） | 提升技能自动选择的命中率 |
| P1-3 | **rollout 持久化度量** | ✅ **已执行（2026-09-07）**：`rolloutMetrics.ts` 落地 ordinal/持久化/压缩度量（total/uncompressed/compressed/totalBytes/savedBytes/savedPct/ordinal/persisted），+3 测试，session-kit 34/34 绿；台账 rollout 条目同步 | 会话日志的可观测性与增量回放 |
| P1-4 | **thread-store 持久后端** | ✅ **已执行（2026-09-07）**：`JsonlFileThreadStore` JSONL 落盘后端（线程+队列双文件、跨进程 durable、坏行容忍、零原生依赖）+ `createThreadStore` 工厂（file→durable，默认内存），+4 测试；sqlite 后端按需另立项 | 若 dsh 需要跨进程 durable thread，需补一个后端（file/sqlite） |

### P2 · 产品/环境决策类（非移植缺口，按需）
| # | 项 | 说明 |
|---|---|---|
| P2-1 | **vendor 二进制行为（bwrap/shell-escalation/process-hardening）** | 已改判 E5。若 dsh 想要原生对等能力（不依赖 vendor exe），属独立产品 epic，不在 codex 移植范围内 |
| P2-2 | **codex-schema protocol 草图 M1→zod 正式形状** | ✅ **已执行（2026-09-07）**：五面 validate.ts 全部 zod 形式化（`zodUnion` 分发器 + `sketchMember`/`presenceKeys` 字段 schema）；先写语义锁 17 测试钉死 ok/variant 契约再重写，**原契约测试零改动通过**；修复 1 处 zod 语义差（显式 undefined 键被 parse 丢弃 → `presenceKeys` 改 `z.custom` 直测原始输入）。zod 本就是显式 devDep（^3.24.0，实测 3.25.76，非幻影依赖）。**typecheck 已跑通**（standalone TS 5.x 工具链，`tsc --noEmit` 全包 0 错误）；**types.ts 迁移定性**：摘除 @ts-nocheck 实测 **366 处类型错误**（机械翻译结构性缺陷：缺失引用类型 WireCellId/CellId 等、重复成员）→ 需上游形状对照的重写项，非顺手改，列为后续 epic |
| P2-3 | **memories/write LLM 整合管线 (phase1/phase2)** | 需 LLM，超出蒸馏面，属 dsh 自有能力 |
| P2-4 | **ext/guardian-v2** | 仅 PROMPT-ONLY 蒸馏（分类器代码 OpenAI 绑定），符合预期 |

---

## 四、下一阶段执行清单（建议顺序）

1. **P0-1**：给 `SessionIndex` 加纯 JS 回退存储后端，让会话镜像测试在本环境真正跑起来（消除「跳过即绿」的假象）。完成后 session-kit 测试应无 skip。
2. **P0-2**：决定 linux-sandbox 处置（自建 vs 声明停更），写进台账。
3. **P1 系列**：按 P1-1→P1-4 顺序立项深化，每个件必须带测试 + NOTICE 溯源，沿用「蒸馏优先、不背运整 crate」原则。
4. **季度对齐（2026-11）**：按 ROADMAP-09-06 第三节同口径重跑（verify_coverage → 审计 → 对齐 0.154+ → 回归），差分向量库已就绪可机器量化忠实度。

---

## 五、本回合交付物
- `codex-config-importer/src/utils/pathUri.ts`（修复 POSIX 路径反斜杠化缺陷）
- `codex-config-importer/test/utils.test.ts`（修复后 18/18 绿）
- `codex-session-kit/src/sessionIndex.ts`（可插拔存储 + 纯 JS 回退 + `close()` 释放句柄）
- `codex-session-kit/test/sessionKit.test.ts`（去掉 skip 闸，会话镜像真实跑通）
- `codex-policy-engine/src/commandSafety.ts`（新增 `detectEscalation`，落地 shell_detect 提权选路）
- `codex-policy-engine/test/commandSafety.test.ts`（+2 提权路由测试，45/45 绿）
- `dsh-codex-ledger/coverage.yaml`（design-only 7→0；shell-command 审计更新）
- `ROADMAP-2026-09-06.md`（顶部加对账说明）
- 本文档 `ROADMAP-2026-09-07-PHASE2.md`
- `codex-session-kit/src/rolloutMetrics.ts` + `test/rolloutMetrics.test.ts`（P1-3 ordinal/持久化/压缩度量）
- `codex-session-kit/src/threadStore.ts` + `test/threadStore.test.ts`（P1-4 durable JSONL 后端 + createThreadStore 工厂）
- `codex-skills-kit/test/executor.test.ts`（fixture 迁移 tmpdir，消除 repo 本地 rmSync 依赖，见二.8）
- `codex-schema/src/handwritten/zodUnion.ts` + 五面 validate.ts zod 重写 + `test/validatorSemantics.test.ts`（P2-2，见二.11）
- `dsh-codex-ledger/scripts/check_yaml_json_consistency.mjs`（台账双件一致性守卫 + 全量镜像同步）
- `codex-policy-engine/src/parseCommand/shlex.ts`（shlex-1.3.0 忠实移植：`shlexSplit`/`shlexQuote`/`shlexTryJoin`/`shlexJoin`）
- `codex-policy-engine/src/parseCommand/bashWordSeq.ts`（bash.rs 词序列接受契约的手写词法器实现，替代 tree-sitter）
- `codex-policy-engine/src/parseCommand/shellDetect.ts` / `powershellExtract.ts`（shell 类型判别 + PowerShell `-Command` 提取）
- `codex-policy-engine/src/parseCommand/parseCommand.ts`（parse_command.rs 全量分类器，1,025 行）
- `codex-policy-engine/test/parseCommand.test.ts`（106 测试，与上游 83+23 逐名对齐）

---

## 六、P1-1 续作：`parse_command` 全量 bash 文法（2026-09-07 晚）

**前提解除**：此前「无上游 rust 源码 → 2,766 行全量移植不可信、强行移植即造假」的缓议理由已不成立——网络通路可用后取得 `openai/codex` rust-v0.153.4 的 `shell-command/src/parse_command.rs`（2,766 行 / 38 函数）与 `bash.rs`（565 行），逐函数、逐测试比对移植。

| 校验项 | 方法 | 结果 |
|---|---|---|
| 测试名覆盖 | 上游 83 + 23 测试名 ↔ 移植 `it()` 名双向 `comm` diff | **106 = 106，双向零漂移** |
| 高危字面量 | 6 个含多层转义的引号脚本按码点数组独立重建后比对 | **逐字节一致**（`ALL LITERALS MATCH UPSTREAM SOURCES`） |
| shlex 语义 | 拉取 crates.io `shlex-1.3.0` 源码核对 `quote`/`unquoted_ok`/`quoting_strategy`/`next_word` | 分词与引号策略按源码实现，非猜测 |
| 函数面 | 上游 49 函数 → camelCase 归一后比对 | 8 个 tree-sitter 节点遍历内部函数无对应物（手写词法器替代，模块头已注明）；`parse_shell_lc_literal_commands` 未按名移植，消费路径由 `splitInvocationSegments` 承担 |
| 回归 | policy-engine 全包 vitest | **45 → 151 全绿** |
| 全量回归 | 10 包逐包 vitest 实测求和 | **354 passed / 0 failed**（原 248 + 106；config-importer 18 / edit-fusion 10 / net-guard 3 / policy-engine **151** / prompts 6 / sandbox-bin 4 / schema 34 / session-kit 34 / skills-kit 21 / dsh-codex-pack 73） |
| 台账一致性 | `check_yaml_json_consistency.mjs` | 改后 1 处 DRIFT → `--fix` 同步 → 复检 `[OK]`（150 条目） |
| 类型 | standalone TS 5.x `tsc --noEmit` | 新增模块 **0 错误**（包内剩余 37 项为既有 `@types/node` 缺失与 `dsh-plugin.ts` 隐式 any） |

**上游面核验（同日 20:1x，独立于"测试跑绿"的第二意见）**：

| 核验 | 方法 | 结果 |
|---|---|---|
| 移植源 = 锚点 | GitHub raw 取 tag `rust-v0.153.4` 的 `parse_command.rs`/`bash.rs`，去 CR 后与本地快照 `cmp` | **逐字节一致**（2766 / 565 行）——P1-1 的 v0.153.4 锚点说法由此证成，非口头声称 |
| 2026-09-07 历史 manifest 清单检查 | GitHub trees API 取当时目标树并按 `Cargo.toml` 还原 | 当时报告上游 **149 crates**、`NEW-UNREGISTERED = 0`；2026-09-10 的 exact Git-object gate 已发现 revision/provenance 漂移，故此项不再作为当前“台账无遗漏”证明 |
| 台账无孤儿 | 台账标"已移植"条目回查路径是否存在 | **MISSING-BUT-PORTED = 0**（150 = 149 crates + 工作区根 `.`） |
| 本地 `verify_coverage.py` | 对本机稀疏快照运行 | **仍 FAIL（20 条 MISSING-BUT-PORTED）——但属本地快照不全所致**（该快照仅 3 个 Cargo.toml，无 `codex-rs/utils` 等），非台账缺陷；已用上两行的 trees API 路径替代取证。注：git fetch 取锚点 sha/tag 均因 SSL 握手失败不可用，改用 curl + API 通路 |

**过程中发现并修复的真实缺陷（非测试缺陷）**：
1. `summarizeMainTokens` 对空 token 数组崩溃（`head.toLowerCase()` on undefined）——上游 `split_first()` 落 catch-all `Unknown{cmd:""}`，补守卫对齐。
2. `src/index.ts` 重复导出 `shlexSplit`（commandSafety 与 shlex 各一份）→ 导致 `policy.test.ts`/`starlarkLite.test.ts` **整文件 import 失败**；根治方式是**去重**：`commandSafety.shlexSplit` 改为复用忠实移植版，包内不再有第二套 shlex 实现。
3. 补测 3 条上游用例（`preserves_quoted_literals` / `rejects_double_quoted_escapes` / `rejects_runtime_expansion_in_plain_words`）后，暴露并确认了双引号内 `\n` 字面量**应被接受**（仅 `\` 后跟 `" \ $ \`` 或换行才构成 escape_sequence）——与移植实现一致。

## 七、下一轮执行记录（2026-09-07）

- **approval/evidence freshness（续作）**：`codex-policy-engine/src/approvalEvidence.ts` 提供无 OpenAI 绑定的审批证据不变量，按资源指纹和决策绑定，拒绝 invalid-window / revoked / not-yet-valid / resource-mismatch / decision-mismatch / expired 六类失效；`test/approvalEvidence.test.ts` 4 条行为测试全绿。尚未接入 dsh runtime 的实际 approval feedback seam，也不宣称完成 extension decision API。

- `codex-edit-fusion` 已补全 patch 级事务边界：任一 hunk/file/move 冲突时回滚整个 patch，结果不再出现早期文件已改、后期文件失败的半提交；多 hunk 改为消费前一 hunk 结果；新增目标冲突拒绝。测试 **14/14**。
- `dsh-codex-pack` 新增 `validatePackLayout()`、`scripts/check-pack.mjs`、`npm run check:pack` 与 `npm run pack:dry`；本地 preflight **7 个 sibling modules 通过**，pack dry-run 共 21 个文件。
- `dsh-codex-pack` 继续执行：新增 `buildInstallPlan()` / `InstallationPlan`，`install()` 不再只是日志 stub，而是读取 manifest、执行 preflight 并返回确定性的 dependencies/bundles/patchPath 计划；不写入用户 profile。新增测试后 pack **75/75** 通过。下一步才是显式授权后的 profile writer。
- 上游 17 提交筛选记录见 `dsh-codex-pack/docs/UPSTREAM-17-COMMIT-REVIEW.md`：extension decision 最小适配层已落地；stale approval/evidence freshness 已落地为无 OpenAI 绑定不变量；DSH MCP tools-only/runtime 缺口已核实，user-verification 与 elicitation 保持不广告且暂不迁移；Guardian connection pool 暂不迁移。
- `codex-schema` 类型层四个可控分面已落地：`exec-server-protocol` 完成结构化 wire contracts，`protocol` 完成基础别名与兼容开放记录，`history` 按当前消费面拆出 rollout envelope、MCP resource origin checkpoint、initial-history/window/legacy 兼容类型，`code-mode-protocol`（2026-09-07）移除机械翻译文件的 `@ts-nocheck`，为 content items、runtime/wait/execute outcomes、tool definitions 补齐命名接口与 tagged unions，并保留 `codemodeprotocol_Structs` 开放兼容导出。四者均以 standalone TypeScript 5.7 `tsc --noEmit` **0 错误** 和 schema 全包测试通过验证。`history` 对未被 DSH 消费且未核实的上游 payload 明确保留 `unknown`；`code-mode-protocol` 的能力协商、错误载荷和 session/provider 运行时面仍未核实，不宣称完整上游协议覆盖。

- **policy-engine DSH 适配器已修复并执行（2026-09-07 续）**：`codex_command_safety_check` 原调用未定义的 `dangerousCommandMatch`，实际执行会抛 `ReferenceError`；现改为复用已导入的 `dangerousCommandMatchLine`。同时将既有 `approvalCache` 真正传入 `evaluateCached`，仅缓存规范化命令的静态 `Policy.check()` 结果，明确不缓存 `allowed-once` 或任何用户审批结果。新增 `test/dsh-plugin.test.ts` 4 条插件缝测试（工具执行、waterfall 透传、allow/deny/ask 映射、规范化缓存边界），policy-engine **159 passed / 0 failed**；重建 `lib/index.js` 后 package-export smoke 得到 `ForcedRm`。当时 standalone `tsc --noEmit` 暴露 33 项工程欠账（缺 `@types/node`、`dsh-plugin.ts` 隐式 any、`shellParser.ts` 1 处结构错误）；已于 2026-09-08 00:12 全部清零，见下方执行记录。

- **云端/本地同步与 CI（2026-09-07 23:4x +08:00）**：`active/dsh-codex-monorepo` 本地 HEAD 与 GitHub `shine-233/dsh-codex@main` 均为 `7ce2d733d61d5aac0406fd4186ba34f5c6f390d5`，ahead/behind 为 0/0、无开放 PR；但最新 GitHub Actions run `34123388436` 为 **failure**，根因是 config-importer 的 4 个 Windows 专属路径断言在 Ubuntu runner 上失败（14 passed / 4 failed），不是“云端全绿”。当前工作树的 Codex 续作仍未提交/推送，故“提交点同步”不等于“工作树功能已同步”。下一项优先修 CI 跨平台测试，再推进 extension decision/runtime feedback seam。

- **CI 跨平台测试修复 + 全量回归（2026-09-07 23:56 +08:00）**：`codex-config-importer/test/utils.test.ts` 已移除 4 处 Windows/本地 checkout 假设：绝对路径用 host-native `resolve`/`join`，大小写比较按 `process.platform`，git root 按实际目录结构比较，Windows file URI 在 POSIX 主机预期正斜杠。config-importer 本地 **21/21**；10 包逐包 Vitest 合计 **372 passed / 0 failed / 0 skipped**（config-importer 21 / edit-fusion 14 / net-guard 3 / policy-engine 159 / prompts 6 / schema 34 / session-kit 34 / skills-kit 21 / sandbox-bin 4 / pack 76；36 test files）。pack preflight **7 sibling modules OK**，`npm pack --dry-run` **23 files**，台账 YAML/JSON **150/150 语义一致**。由于本轮未获 commit/push 授权，Ubuntu Actions 尚无新 run；只能宣称本地修复已验证，不能宣称云端 CI 已转绿。

- **policy-engine 类型欠账已清零（2026-09-08 00:12 +08:00）**：为 `dsh-plugin.ts` 的配置、工具注册、waterfall 与静态求值缓存补最小本地类型，规则 decision 改为运行时白名单守卫；`shellParser.ts` 构造 `ShellInvocation` 时补齐 `substitutions` 必需字段；`package.json` 固定 `@types/node 26.4.1` / `typescript 5.9.3` / `vitest 2.1.9` 并同步 pnpm lock。`pnpm run typecheck` **0 错误**（此前 33 项 `process`/`Buffer`、implicit-any 与结构错误全部消除），测试仍 **159/159**，重建 package bundle 后 smoke 仍为 `ForcedRm`。这只清理类型与适配器边界，不代表 DSH 已暴露 extension approval outcome feedback。

- **extension decision/runtime feedback 最小适配层已执行（2026-09-08 00:25 +08:00）**：对照上游 `e1eb98461` 的 `ApprovalReviewContributor`/`ApprovalDecisionInput` 以及本地 DSH 实际契约，新增可选 `decisionAdapter`：从 `tools/pre-execute` 传递 host-owned `callId` / `rootCallId` / toolName / arguments / `AbortSignal`，仅映射 delegate→`next()`、ask、deny；缺身份、已取消、同步抛错或异步拒绝均 fail closed。新增独立 `runtimeObserver` 监听 `tools/result`，按调用 ID 观察 authoritative 最终结果，但明确**不把它宣称为审批 outcome**。新增 3 测试覆盖三态映射、异常/缺身份关闭、最终结果观察，policy-engine **162/162**，typecheck **0 错误**。经 DSH 源码核验，审批 ask 仍由 ToolRuntime 调 `ApprovalService`，内部只有一次性 `allowed-once/rejected/cancelled/unavailable`；没有通用 `approval/result` 或 `approval/feedback` 事件，因此不伪造可复用审批记忆，也不把 `approvalEvidence.ts` 接成 remembered grant。

- **policy-engine 公共 API 与全仓终态验证（2026-09-08 00:33 +08:00）**：`src/index.ts` 现保留原 package/plugin exports（`name` / `inject` / `apply` / evaluate helpers），并公开导出 `ExtensionDecision*` 与 `ExtensionRuntime*` 类型；插件测试改从 package index 导入并以 TypeScript 编译期实例钉住类型面。README 明确 adapter 存在时接管本插件的 pre-execute 分支，`delegate` 只进入后续 waterfall、不回落到同插件本地规则。由 `src/index.ts` 重建 ESM bundle（78.2 kB），package-export smoke 同时检查 8 个既有/新增导出并得到 `public-export-smoke: codex-policy-engine tools deny`；陈旧 `package-lock.json` 的旧包名/宽版本也已按当前 package metadata 同步（主工作流仍使用 pnpm）。随后逐包实跑 10 包 **375 passed / 0 failed / 0 skipped**（config-importer 21 / edit-fusion 14 / net-guard 3 / policy-engine 162 / prompts 6 / sandbox-bin 4 / schema 34 / session-kit 34 / skills-kit 21 / pack 76）；policy typecheck **0 错误**。pack preflight **7 sibling modules OK**，dry-run **23 files / 17.3 kB packed / 53.0 kB unpacked**，台账 YAML/JSON **150/150 语义一致**。`npm pack` 仍仅有 pnpm 注入 env config 与缺 `.npmignore` 的非致命 warning。补充：npm 对这份兼容 lockfile 报出 **5 项 dev-only tooling advisory（3 moderate / 1 high / 1 critical）**，核心为 Vitest UI server `GHSA-5xrq-8626-4rwp` 与 Vite 路径/UNC 开发服务器问题；当前只运行非监听的 `vitest run`，但仍应跨 10 包统一升级。未执行 `npm audit fix --force`，避免未经评估的 breaking upgrade；该跨包升级已拆为独立待办，不混入本轮迁移实现。

- **config-importer 脱敏 fixture、包 API 与 bundle 已收口（2026-09-08 01:03 +08:00）**：代表性 `config.toml` 现覆盖 feature array、日期样式原文、多行基本字符串内 `#`、provider table 与两个 `[[mcp_servers]]`；修复逻辑行注释处理，避免注释截断多行值后续物理行。测试 **21/21**。README 自初始提交就承诺公开 `parseTomlLite`，但历史 runtime bundle 实际只导出 plugin/helper，形成文档—产物不一致；现由 `src/dsh-plugin.ts` 显式重导出，测试改从该 package 入口导入，重建 ESM bundle 后 `public-export-smoke: apply parseTomlLite tomlToCordisPatch OK`，并验证注册工具输出与 helper 一致。没有读取真实用户 `~/.codex`，fixture 不含凭据；仍不宣称完整 TOML 1.0，dotted keys、多行字面字符串与完整日期语义继续保留为证据驱动边界。

- **MCP user-verification/elicitation 准入核验已完成（2026-09-08）**：读取 DSH 主 MCP client 后确认它是 tools-only bridge，初始化明确为 `{ capabilities: {} }`，没有 elicitation/user-verification/auth-change handler、proof-capable provider、account identity 或 auth epoch；`user-questions`/`user-approval` 也不足以承载结构化 proof。故当前能力保持不广告，不在迁移包伪造 gate。只有 trusted-host opt-in、精确模式 capability、connection-generation 单 owner、proof 保密、请求关联、全生命周期 cancellation 与单调 auth/account epoch 同时存在时才可重启；详细裁决已写入 `UPSTREAM-17-COMMIT-REVIEW.md`。

- **extension API 类型项已裁决为“不机械迁移”**：路线图所指 `codex-schema/src/handwritten/extension-api/types.ts` 在当前 checkout 与已检历史均不存在；本地只有 validator 使用的四字段 `ExtensionToolSpec`，生成的 `DynamicToolFunctionSpec` 是 app-server wire 类型，而上游 Rust contributor/executor traits 是进程内 API。当前没有真实消费方要求独立 types 文件，因此不新增虚构 runtime/type surface；未来若消费方出现，只先抽取 validator 的最小本地接口。

- **GitHub/本地/上游刷新核验（2026-09-08 01:2x +08:00）**：`shine-233/dsh-codex` GitHub `main`、本地 HEAD 与本地 `origin/main` 仍同为 `7ce2d733d61d5aac0406fd4186ba34f5c6f390d5`，ahead/behind 0/0、开放 PR 0；但工作树续作尚未提交/推送，最新 Actions 仍是旧 SHA 上的 run `34123388436` failure，不能称云端已同步功能或 CI 已绿。上游本地 `openai/codex` checkout 仍为 `121f91fd5d9dc66017866ce9bdc49f1e182721df`；已执行 `git fetch origin main --prune`，本地 remote-tracking `origin/main` 现与 GitHub 实时 `main` 同为 `adee0b04fa27a8ba5d2e3612b900363cffe72930`，checkout 相对其 **behind 29 / ahead 0**。先前审阅边界 `f3f53ee` 之后新增 12 个非 merge 提交，必须按 `f3f53ee..adee0b0` 增量筛选；未审阅前不能把刷新后的 remote ref 当作已迁移能力。

- **config-importer bare dotted keys 已继续执行（2026-09-08 01:21 +08:00）**：对照上游真实字段路径 `model_providers.<id>.auth.timeout_ms`，`parseTomlLite` 现支持带空白/连字符的 bare dotted assignments，并在当前 table 内相对赋值；inline table 同用一套路径赋值。为避免配置输入触发对象原型修改，`__proto__` / `prototype` / `constructor` 任一路径段均拒绝，已有标量与待建 table 冲突时也不覆写。新增 3 条测试验证 provider table/dotted patch 等价、table-relative auth 路径、空白/连字符与 pollution 拒绝；脱敏 fixture 加入 `auth.timeout_ms = 7000`。config-importer **24 passed / 0 failed**，重建 7.7 kB ESM bundle 后 `dotted-key-bundle-smoke: OK`。全仓 10 包再跑 **378 passed / 0 failed / 0 skipped**（24 / 14 / 3 / 162 / 6 / 4 / 34 / 34 / 21 / 76）；policy typecheck 0 错误，schema 用仓内 TypeScript 5.9.3 交叉 typecheck 0 错误（schema 自身未声明 TypeScript，故其 `pnpm run typecheck` 单独调用会报 `tsc` 不存在，此既有依赖欠账未伪报为通过）。pack preflight 7 modules OK，dry-run **23 files / 17.9 kB packed / 54.0 kB unpacked**，台账 150/150 一致。仍不支持 quoted dotted keys，且不宣称完整 TOML 1.0。

- **2026-09-08 增量实现记录（后由证据审查降级）**：`d665e3bbc` 对应的 `AgentNode`/`formatEnvironmentContextSubagents()` roster 逻辑、排序、parent path 约束和 8 agents / 1,024 bytes 边界均已落地并有当时的算法/产物测试；但它没有接入 DSH `system-prompt/assemble` 或 request lifecycle。2026-09-10 证据等级为 `implemented-unconsumed`，不能作为 multi-agent runtime 或 host prompt integration 完成证明。

- **exec-server 环境 metadata wire 小缺口已继续执行（2026-09-08 02:0x +08:00）**：对照上游 `dbe2f6d52` 的真实 `EnvironmentInfo` serde shape，在既有 `codex-schema/src/handwritten/exec-server-protocol` seam 增加 `executorVersion` 与可选 opaque `providerId?: string`，并新增 runtime validator：历史 payload 不含 `providerId` 仍兼容，字符串接受，非字符串拒绝，shell/executorVersion 必需字段缺失拒绝。schema 定向 12/12、全包 **35/35**、仓内 TypeScript 5.9.3 交叉 typecheck **0 错误**。随后重新逐包实跑 10 包共 **383 passed / 0 failed / 0 skipped**（24 / 14 / 3 / 162 / 6 / 4 / 35 / 38 / 21 / 76）。这里只蒸馏兼容 wire contract；没有移植 SHA-256 build-id producer、启动缓存、Cargo/Bazel stamp，也不把 `providerId` 当 artifact checksum/security attestation，更不宣称 DSH exec-server runtime 已存在。

## 八、2026-09-08 本轮续作：事务边界、运行时证据与 Claude 会话对账

- **apply-patch 协议边界已补齐并验证**：`codex-edit-fusion` 现在严格拒绝未知指令、缺失 `*** End Patch`、空路径、未加 `+` 的 add body、无 hunk 的 update；解析并传递 `*** End of File` 标志。应用层保留原文件 CRLF，多个 hunk 消费前一 hunk 的结果；任何 hunk、文件或 move 冲突使整个 staged map 回滚，物理 write/remove 失败也按初始快照恢复，返回 `applied: []`。新增 EOF/CRLF/malformed/multi-file rollback 用例；定向测试 **18/18**，bundle 已重建。
- **pack profile writer 已从计划升级为安全双文件事务**：dry-run 完全无写入；默认拒绝覆盖已有且不同的非空 `cordis.patch.yml`，显式 `overwritePatch: true` 才可覆盖；package 与 patch 均使用同目录临时文件，apply 前分别备份并在第二次替换失败时回滚；备份不被幂等重跑覆盖，第二次 apply 返回 `changed: false`。新增冲突、双备份、幂等和注入故障回滚测试；`dsh-codex-pack` **78/78**。
- **DSH runtime capability audit 已落档**：`dsh-codex-pack/docs/DSH-RUNTIME-CAPABILITY-AUDIT.md` 记录 MCP client 当前为 tools-only（`capabilities: {}`），只有一次性 open-turn approval 和通用 userQuestions，没有 MCP elicitation/user-verification/auth-change epoch/proof seam；Codex subagent 对 elicitation request 当前明确 decline。因此不伪造这些能力，也不把 approval observer 宣称为 approval feedback。
- **Claude Code 最新会话对账**：最新可定位会话是 `cached-swimming-lovelace`，分支 `claude/modest-panini-0fb73e`，最后停在未提交工作树并随后因 403 额度/认证失败中止；另一个 `objective-mccarthy-aaeff0` 主要留下 CI/lockfile 批量变更。`main` 与 `origin/main` 的已提交基线仍为 `7ce2d733d61d5aac0406fd4186ba34f5c6f390d5`，但续作工作树未提交，故“提交点同步”不等于“当前功能已同步”。本轮只吸收可验证的源码/测试变更，没有搬运未完成依赖噪声。

### 下一步执行顺序（更新）

1. 逐包串行回归并检查生成 bundle、preflight、dry pack 与台账镜像；修复发现的真实失败。
2. 把 Claude worktree 中尚未进入主工作树、且有源码/测试证据的增量逐项比对后再选择性吸收；不合并未完成的 lockfile/CI 批量噪声。
3. 继续检查上游 `adee0b0` 之后的新提交；只有存在 DSH 真实消费 seam 和可验证行为时才迁移。
4. 最终重新核对本地 committed HEAD、`origin/main`、未提交工作区与 GitHub Actions；未经提交/推送不得称云端功能同步。

## 九、2026-09-09 续作核验

- 合并收口后的主分支为 `4496077`，工作树干净；相对 `origin/main` 为 **ahead 16 / behind 0**，因此本轮功能仍未进入 GitHub。
- 重新使用当前依赖跑完 10 包测试，结果为 **392 passed / 0 failed / 0 skipped**：24 / 18 / 3 / 165 / 6 / 4 / 35 / 38 / 21 / 78。
- `dsh-codex-pack` typecheck 继续为 **0 errors**，preflight 为 **7 sibling modules OK**，隔离 npm cache 下 dry-pack 为 **25 files**。
- 当时对 `scripts/rebuild-bundles.mjs` 做了 Windows `.cmd/.ps1` shim 调用尝试，但 esbuild 解析仍受受限 node_modules 路径阻断，故未把本地 `--check` 失败冒充源码漂移；该历史缺口已在 11.5 的 2026-09-10 修复与回归中闭环。
- 上游 `openai/codex` checkout 仍为 `121f91f`，相对 remote `adee0b0` **behind 29**；新增提交尚未发现可在本轮直接迁移的 DSH 真实消费面，继续按证据审查。
- **上游 29 提交增量审计已闭环**：`UPSTREAM-17-COMMIT-REVIEW.md` 覆盖 `121f91f..f3f53ee`，`UPSTREAM-12-COMMIT-REVIEW.md` 覆盖 `f3f53ee..adee0b0`；两份报告合计覆盖当前 `121f91f..adee0b0` 的 **29 个非 merge 提交**。可迁移项已落到 session roster 与 exec-server wire validator；MCP user-verification/auth-change、elicitation proof、Guardian retained authorization/assessment、daemon/PID/release updater 均因缺 DSH 真实消费 seam 保持阻断或排除。

## 十、2026-09-09 集成与发布就绪续作

- **路线图阶段切换（2026-09-09 历史判断，2026-09-10 修正）**：当时台账为 150 条、7 implemented / 46 distilled / 0 active design-only，并据 29-commit report 转向发布准备。后续 revision-aware Git-object gate 识别并建模了该 150-row 集合的时序边界：补录 3 个 endpoint crate，并把 2 个 endpoint 前已删除 crate 保留为 historical rows；当前 153-row temporal ledger 已在 anchor 142 manifests 与 `adee0b0` 151 manifests 两端 exact-set 通过。evidence audit 仍得出 0 runtime-equivalent，当前主线因此是逐条证据纠偏和五个真实 host/package gate，而不是发布完成声明。
- **Git 现场以执行时为准**：本轮开始时本地 `main` 相对 `origin/main` 为 **ahead 20 / behind 0**；仍有本文件的用户未暂存审计行和既有未跟踪核验报告。未经授权不提交、不推送，不能宣称 GitHub Actions 已覆盖本轮改动。
- **pack 改为单一聚合 bundle**：manifest 使用 8 个实际未加 scope 的 package name，并纳入 `codex-skills-kit`；`codex-sandbox-bin` 保持独立可选。安装计划链接 pack 与 8 个组件，但 profile `dsh.profile.bundles` 只增加 `dsh-codex-pack`。聚合 patch 按 manifest 顺序挂载 8 个具体插件，不再尝试挂载 helper pack 自身。
- **用户层所有权修正**：profile writer 现在只事务性替换 `package.json`，保留 dry-run、稳定 `.bak`、幂等与失败回滚；profile 的 `cordis.patch.yml` 逐字节不变。pack patch 由 bundle package 的 `dsh.bundle.patch` 加载，用户 patch 仍是后置层。
- **fail-loud preflight**：现在核验 pack/package identity、pack 与每个 sibling 的运行时 export/main 对应 built entry、重复 manifest package、每个 `dsh.bundle.patch` 的严格 insert 结构和 package id/name，以及聚合 patch 与 manifest 的身份和顺序完全一致；malformed operation 不再静默跳过。
- **2026-09-09 source-tree Loader 产物证据（后由证据审查限定）**：固定版本 Cordis/Loader 通过测试注入的 sibling bundle importer 激活 8 个提交 `lib/index.js`，观察到 11 个工具并执行只读 `codex_policy_check`。该测试不依赖 sibling DSH checkout，却仍依赖 sibling migration bundles 和 custom importer；它只证明 source-tree activation，不证明 bare-package resolution、clean registry install、offline multi-tarball/single-tarball closure 或 DSH host runtime integration。
- **2026-09-09 本地发布准备历史证据**：当时的测试/typecheck、preflight、dry pack、bundle drift 与 150-row mirror 检查通过，只说明对应工作树的本地构建健康。2026-09-10 审查确认 registry dependency closure、offline install modes 和五个 host integration gate 均未闭环，因此“发布门本地闭环”结论撤回；旧计数不得当作当前验证结果。
- **能力边界不变**：MCP elicitation/user-verification proof、auth/account epoch、remembered approval、Guardian retained authorization/assessment、exec-server identity producer、Linux sandbox 重建与 daemon/PID/updater 仍无可信 DSH 消费 seam，不在本轮模拟。

## 十一、2026-09-10 源码差分与下一阶段执行

### 11.1 云端、本地与上游现场

- **GitHub 与本地未同步**：刷新 remote 后，本地 `main` 相对 `origin/main` 为 **ahead 21 / behind 0**；本地 HEAD `166eefb`，GitHub `main` 仍为 `7ce2d73`，且当前工作树还有未提交实现。没有开放 PR，因此云端既不含这 21 个本地提交，也不含工作树续作。
- **云端 CI 仍是旧证据**：最新 Actions run [`34123388436`](https://github.com/shine-233/dsh-codex/actions/runs/34123388436) 在旧 SHA `7ce2d73` 上失败；唯一失败 job 是 `codex-config-importer` 的 4 个 Ubuntu/Windows 路径假设，其他 9 个 package job 通过。该跨平台测试已在本地后续提交/工作树修复，但尚无当前 SHA 的云端 run，不能称 GitHub CI 已绿。
- **上游源码边界**：唯一 `openai/codex` 本地 checkout 是 `research/upstream/codex`，materialized HEAD `121f91fd5`，相对本地 tracking `origin/main=adee0b04f` behind 29；它是 blob-filtered sparse checkout，当前只物化 `protocol/src` 与 `shell-command/src`。`970b7f2ff4f6` 继续作为历史全量 provenance anchor，`121f91f..adee0b0` 继续作为两份增量审计范围，不混写为新的全量锚点。

### 11.2 缺口排序（必须有真实消费 seam）

| 顺序 | 上游能力 | DSH 目标 / 消费面 | 裁决 |
|---|---|---|---|
| 1 | `protocol/src/sanitized_git_url.rs` | `codex-session-kit.parseRolloutText()` 暴露持久 rollout header 前的 metadata 边界 | **✅ 本轮执行**：纯函数、keyless、直接阻断 remote token/用户名/密码从历史 rollout 泄漏 |
| 2 | `shell-command/src/command_safety/powershell_*` + 68-case lowering fixture | `codex-policy-engine` 现有 command safety / pre-execute seam | **✅ 本轮执行**：新增不启动 PowerShell 的 fail-closed literal lowering，68-case fixture 全对齐，并接入 danger policy 与审批 canonicalization |
| 3 | `history/src/reconciled_retained_context.rs` (`aa12ab45d`) | `codex-session-kit` rollout replay | **输入契约先行**：message-id / turn-id+text / acceptance-order 算法可移植，但现有 rollout payload 仍为 `any`，须先定义 host-owned acceptance order/source completeness |
| 4 | `protocol/src/shell_environment.rs` 的 non-inheritable env scrub | 需要真实 subprocess/environment assembly seam | **暂缓**：算法本身可移植，但当前八插件没有 child-process producer；只加无消费者 helper 不算迁移完成 |
| 阻断 | permission-profile intersection/snapshot、MCP verification/auth、Guardian retained authorization、native sandbox/daemon | 需要 host-owned authority/runtime | **保持阻断**：不能用 schema/helper 冒充已生效的权限或认证 runtime |

### 11.3 已执行：rollout Git remote 凭据脱敏

- 新增 `codex-session-kit/src/sanitizedGitUrl.ts`：覆盖 HTTPS/file/SSH/SCP、IPv6 与嵌套 remote-helper；只重建 authority，不解码/规范化 repository path；SSH 的惯例 `git` transport identity 保留，其他 username 与所有 password/token 移除；helper command payload 与 malformed URL fail closed，错误消息不回显原输入。
- `parseRolloutText()` 现于返回 `session_header` / `session_meta` 前处理 `payload.git.repository_url` 与 legacy `payload.git_info.repository_url`；无效历史 remote 仅丢弃该字段，不丢整份 header，保持 tolerant rollout import 语义。
- 公共 API 导出严格 sanitizer 与 tolerant optional sanitizer；README 明确这只是 metadata 脱敏，不是网络或文件系统安全边界。
- 定向与全包验证：`codex-session-kit` **56 passed / 0 failed（8 files）**，`pnpm typecheck` **0 errors**。新增 18 个测试（12 组表驱动 remote + encoded/opaque path、4096 层非递归 helper、malformed secret-safe error、optional legacy，以及 2 个真实 parser boundary 用例）。

### 11.4 已执行：PowerShell literal lowering

- 将本地上游 `shell-command/src/command_safety/fixtures/powershell_lowering.json` 的 68 个行为样本固定进 `codex-policy-engine/test/powershell_lowering.json`；先以缺失模块得到红测，再实现 `src/powershellLowering.ts`。
- lowering 只接受可静态确定的 literal argv：支持单/双引号、PowerShell backtick 的版本中立转义、Windows 路径、`|` / `||` / `&&` / `;`、注释与 `--flag=value`；变量、子表达式、here-string、重定向、invocation operator、`--%`、Unicode syntax alias、非规范数值和未知结构均返回 `null`。它不启动 PowerShell，也不宣称完整 PowerShell parser/runtime。
- `commandSafety` 现优先把完整 PowerShell pipeline 降为多条 argv 后逐条执行 Windows danger policy；不支持的脚本仍走既有 best-effort fallback。审批 canonicalization 对单条 literal PowerShell 命令按 argv 归一化，多条或 opaque script 继续保留带类型前缀的原文键。
- 实测：`codex-policy-engine` **241 passed / 0 failed（12 files）**，其中新增 fixture+集成 **70 tests**；typecheck **0 errors**；built package 三个 PowerShell API export smoke 通过。`codex-session-kit` built export smoke、**56/56** 与 typecheck 已通过；pack preflight 为 **8 modules**，真实 Loader smoke **1/1**；全仓 **10 bundles / 0 drift**。

### 11.5 紧接执行门

1. **✅ 已执行（2026-09-10）**：Windows bundle launcher 现只把 `.cmd` / `.bat` 经 `cmd.exe /d /s /c` 启动，并给完整 command string 加外层 quote；`.ps1` 明确 fail closed。新增真实 Windows regression：临时 shim 路径含空格，逐项验证 entry/outfile 与 `^ & | < >` 参数不变；`%` / `!` / quote / 换行等会被 `cmd.exe` 展开或无法无损表达的输入直接拒绝。实测 **5/5**，并用路径含空格的真实 esbuild `.cmd` wrapper 跑通 policy-engine **1 package / 0 drift**；同轮补上 package-local pnpm transitive esbuild launcher 解析，使无 `--esbuild` 的标准命令也实测 **10 bundles / 0 drift**。CI 新增独立 `windows-latest` shim job，云端结果仍须实际 run 后才能声称通过。
2. **✅ YAML/JSON mirror 与 exact manifest completeness 均已闭环（2026-09-10 更新）**：ledger consistency 已加入 CI，metadata-only `--fix` 可修复镜像 metadata；补录 `attachment-store` / `mxc-sandbox` / `windows-sandbox-service` 后当前为 153/153 语义一致。`inventory-provenance.json` 显式记录 `guardian-context` / `utils/git-discovery` 的 post-anchor 引入、`mcp-server` 两行的删除及 `realtime-webrtc` 的重引入；revision-aware verifier 已在 historical anchor **142 manifests** 与 `adee0b0` **151 manifests** 两端 exact-set 通过。153 是跨时序 ledger row 数，不是任一 endpoint 的 manifest 数。
3. **✅ 全仓本地回归刷新（2026-09-10）**：10 包逐包执行 Vitest 与 `pnpm typecheck`，实测 **493 passed / 0 failed**，十个 typecheck 全部 0 errors；分包为 24 / 18 / 3 / 241 / 6 / 35 / 56 / 21 / 4 / 85。另有根级 Windows shim regression **5/5**、pack preflight **8 sibling modules**、bundle check **10/10 / 0 drift**。这些是本地结果，不代表新增 CI jobs 已在 GitHub 通过。
4. 发布完整性另设硬门：当前 aggregate patch 以 bare package name 挂载 8 个组件，但 pack 发布物尚未声明这些组件为可解析 runtime dependencies；在 registry/package source 明确前，不宣称“只安装 pack tarball 即可启动”。
5. 源码能力下一候选改为 typed rollout→DSH Session bridge：必须先以真实 DSH `SessionEvent` validator、持久化和 resume seam 定义 mapping；不再把当前 `{type,payload}` 泛化数组称作可回放 DSH session。保留 apply-patch fs containment 为需要 DSH filesystem delete/rename/batch seam 的跨仓高优先级项。


## 十、2026-09-10 上游函数面缺口裁决（对照 shell-command crate）

**缘起**：2026-09-10 审计（`UPSTREAM-AUDIT-20260910.md`）实测上游 `shell-command` crate 共 38 个 pub fn，移植未见对应导出的有 **16 个**。本节逐个裁决，把"没看过"变成"看过并决定了"。

审计前提不变：上游本地 `research/upstream/codex` HEAD = `121f91fd5`，**behind 29**，且为稀疏快照（`codex-rs/` 仅 `protocol/` + `shell-command/`）。

### 裁决表

| # | 上游函数 | 上游实现性质（实测） | 裁决 | 理由 |
|---|---|---|---|---|
| 1–6 | `shell_detect.rs`：`default_user_shell` / `default_user_shell_from_path` / `get_shell` / `get_shell_by_model_provided_path` / `ultimate_fallback_shell` / `fallback_powershell_shell_for_elevated_windows_sandbox` | 探测**本机实际安装的 shell 可执行文件**：读 `/etc/passwd`、Windows 路径与 WindowsApps 不可达路径过滤、elevated sandbox 兼容性判断（含 unix/windows 两份 `get_user_shell_path`） | **E5 排除** | 依赖真实文件系统与平台特定路径。本插件只做命令串**静态判定**，不派生 shell 进程，无 DSH 消费面 |
| 7–8 | `shell_snapshot.rs`：`snapshot_script` / `snapshot_state_and_environment_script` | 生成脚本以**捕获与恢复 shell 状态**（cd / export），服务于 persistent shell session | **E5 排除** | 需要真实 shell 执行与跨命令状态保持；DSH 侧当前无 persistent shell session 概念 |
| 9 | `command_safety/powershell_parser.rs`：`try_parse_powershell_ast_commands` | **spawn 真实 PowerShell 进程**执行内嵌 `powershell_parser.ps1` 取 AST（`Command::new(executable)` + `include_str!`） | **E5 排除** | 依赖本机 PowerShell 可执行文件与进程派生，静态判定面无消费面 |
| 10 | `command_safety/powershell_tree_sitter.rs`：`try_parse_powershell_commands` | tree-sitter PS 语法树解析 | **已替代（非缺失）** | `powershellLowering.ts` 头部注释明确声明 aligned with `powershell_tree_sitter.rs`，采用**保守字面量降级 + 未知语法 fail closed**。属有意识的替代实现，此前未登记，现补登记 |
| 11 | `is_dangerous_command.rs`：`dangerous_command_match_for_platform` | 薄封装：转发 `dangerous_command_match_with_depth(command, 0, platform)` | **建议补齐** | 能力已有（`dangerousCommandMatch` + `isDangerousCommandWindows`），只缺一层显式平台分派。成本低，补后 API 与上游对齐，便于后续对照回归 |
| 12 | `is_dangerous_command.rs`：`dangerous_powershell_words_match` | 薄分派：Windows → `is_dangerous_powershell_words`，非 Windows → `None` | **建议补齐** | 实质能力已有（`isDangerousPowershellWords` 对应 `is_dangerous_powershell_words`），只缺平台门 |
| 13–14 | `bash.rs`：`try_parse_shell` / `try_parse_word_only_commands_sequence` | **tree-sitter 强绑定**（`Parser::new()` + BASH grammar，按节点 kind 遍历） | **E5 排除** | JS 侧无 tree-sitter grammar 依赖，1:1 移植不可得；已由 `bashWordSeq.ts` 手写词法器替代（见二.6 遗留说明） |
| 15 | `bash.rs`：`parse_shell_lc_literal_commands` | tree-sitter 字面量命令提取 | **已登记替代** | 消费路径由 `commandSafety.splitInvocationSegments` 承担（二.6 已注明，行为等价近似、非节点级忠实） |
| 16 | `powershell.rs`：`prefix_powershell_script_with_utf8` | **执行期**给脚本加 UTF-8 输出前缀常量 | **E5 排除** | 执行期功能，静态判定面无消费面 |

### 汇总

- **E5 排除：12 个**（#1–9 的 9 个 + #13、14、16）
- **已替代 / 已登记：2 个**（#10、#15）
- **建议补齐：2 个**（#11、#12，均为薄封装层，能力已存在）→ **2026-09-10 已实现**：`dangerousCommandMatchForPlatform` 与 `dangerousPowershellWordsMatch` 已落地，含 4 条测试（等价性、平台门、PS 专属作用域）；typecheck 0 错、policy-engine 245 测试全绿、bundle 已重建且 10 包 0 drift。**暂未提交**：`commandSafety.ts` / `index.ts` / `lib/index.js` 同时含并行会话的未提交改动，按 own-file 规则不代他人提交，待其落定后再补交。

**结论**：所谓"函数面覆盖约 58%"需要修正理解——16 个缺口里**实质能力缺失为 0**；真正值得动手的 2 个薄封装（#11、#12）已于 2026-09-10 补齐，用于让平台分派语义显式化、API 与上游对齐。其余 12 个是有充分理由的排除，2 个是已实现的替代。

补齐后的行为实测（与上游语义逐条吻合）：`cmd /c del /f x` 在 windows → `Other`、posix → `null`；`pwsh -Command "Remove-Item -Force file"` 在 windows → `Other`、posix → `null`；无害脚本与 cmd.exe 均不进入 PS 词扫描作用域。

### 重启条件（写入台账口径）

| 排除组 | 何时需要重新评估 |
|---|---|
| #1–6 shell 探测 | DSH 侧要**真实派生 shell 进程**执行命令时 |
| #7–8 shell 快照 | DSH 引入 **persistent shell session**（跨命令保持 cd/export）时 |
| #9 PS AST（进程） | 具备可调用的 PowerShell 可执行文件且接受进程派生开销时 |
| #13–14 tree-sitter | JS 侧引入 tree-sitter grammar 依赖（届时可用真 AST 替代手写词法器，并需重跑等价性验证） |
| #16 UTF-8 前缀 | 进入执行期脚本下发路径时 |

### 仍存疑、需补证据的一条

`codex-skills-kit/src/selector.ts`：路线图称移植自 `ext/skills` 的 `dynamic_skill_selector`，并给出具体打分规则（名/别名命中 +3、名内词 +2、描述词 +1、前缀重叠 +1）。实测本地上游快照 `find -iname "*skill*"` **返回空**，该声称目前**无任何可溯源证据**。这是唯一一条给出具体算法却无法溯源的移植件，需在补齐上游快照后优先复核。


## 十一、2026-09-10 下午：完整源码重新对照（含对上一节的修正）

### 修正：第十节"其余 8 个包无法验证"是错的

`research/upstream/codex` 设了 `core.sparseCheckout=true`，工作树只放行 `codex-rs/protocol/` 与 `codex-rs/shell-command/`。**但 `.git` 对象库有 112,149 个对象，`git ls-tree HEAD codex-rs/` 列出 124 个条目——完整源码一直在本机**。用 `git show HEAD:<path>` 可直接读取，无需检出、不占磁盘。

结论：第十节"只有 policy-engine 能真正对照"**被工作树表象误导**，本节的对照覆盖全部包。审计时不要只看工作树。

### 规模实测（上游取 crate src 的 .rs，排除 tests；移植取 src 的 .ts，排除 .test.ts）

| 移植包 | 对应上游 crate | 上游行 | 移植行 | 占比 |
|---|---|---|---|---|
| codex-policy-engine | shell-command + execpolicy | 8,265 | 3,285 | 39.7% |
| codex-prompts | prompts + collaboration-mode-templates | 655 | 151 | 23.1% |
| codex-edit-fusion | apply-patch | 4,828 | 341 | 7.1% |
| codex-config-importer | config | 20,583 | 834 | 4.1% |
| codex-session-kit | rollout + thread-store + file-search + message-history + agent-graph-store + memories | 38,950 | 1,315 | 3.4% |
| codex-skills-kit | ext/skills | 11,704 | 318 | 2.7% |
| codex-sandbox-bin | linux-sandbox + bwrap + process-hardening + shell-escalation | 9,226 | 90 | 1.0% |
| codex-net-guard | network-proxy | 16,885 | 138 | 0.8% |
| codex-schema | protocol + history + code-mode-protocol + exec-server-protocol | 33,280 | 9,145 | 27.5%（注） |

注：schema 的 9,145 行分布在 719 个文件，是生成的 TS 类型而非手写移植，不应按 27.5% 理解成覆盖四分之一。

### 三项具体偏差（实证）

1. **skills selector**：`dynamic_skill_selector` 模块真实存在（fielded_bm25 / character_ngram / rrf_lexical_char / weighted_lexical / lru_plus_character_routing，2,000+ 行）。上游是 **BM25 + 字符 n-gram + RRF 融合 + LRU 缓存**的检索系统，权重为 `saturating_add(256/128/64/24)` 且 `short_description` 与 `description` 分开计分；移植 `selector.ts` 仅 94 行，取 weighted_lexical 一路的近似，权重自定为 **+3/+2/+1/+1**。移植文件头自称 distillation，措辞诚实；**路线图正文把 +3/+2/+1 当作既有算法陈述，是描述精度问题，不是伪造**。
2. **edit-fusion**：上游 apply-patch 约 4,828 行（lib 1,444 / invocation 1,036 / streaming_parser 924 / parser 682 / file_update 335），移植 341 行，**无流式解析、无 invocation 层、无独立 file_update**。且上游 `rollback`/`atomic`/`transaction`/`revert`/`restore` **命中 0 处** → 路线图所称"patch 级事务边界、任一冲突回滚整个 patch"是**移植侧自行设计的增强**，不是移植自上游。增强合理，但应改标为"移植侧增强"。
3. **policy-engine**：58% 函数面，16 个缺口已裁决（E5 排除 12 / 已替代 2 / 已补齐 2），结论不变。

### 语义澄清（重要）

**没有发现伪造**：抽查到的每条声称都能在上游找到对应物。但"完成度"的口径是**"有可运行的蒸馏件"**，不是"与上游等价"：

| 路线图用词 | 实际含义 |
|---|---|
| `distilled` | 保留契约的简化实现，非能力等价 |
| 「已准入能力 100% 有实现」 | 每条都有可运行蒸馏件；按代码量覆盖 0.8%–40% |
| parseCommand「1:1 对齐」 | 仅在 shell-command crate 的 106 个测试维度成立 |

### 插件还要不要改

取决于目标：DSH 侧可用（当前仅注册 2 个工具）→ 现状够用；要声称与上游等价 → 差距大（edit-fusion 缺流式解析、skills 检索差一个量级、net-guard 0.8%、sandbox-bin 1.0%）；要接 exec 消费面 → 需 policy-engine 那 12 个被排除的函数。

详见 `UPSTREAM-PARITY-20260910.md`。
