# codex→dsh 移植套件 · 下一阶段路线图（2026-09-07 对账 + 续作）

> 前序文档：`ROADMAP-2026-09-06.md`（同日已执行五轮）。本文档在对账复核基础上，给出「39 条设计收割」是否仍属实的结论，并固化下一阶段执行清单。
>
> 审计铁律（沿用）：数字必须可溯源；测试缺陷与程序缺陷必须区分；**不得**为凑进度伪造 design-only→distilled 的判定。

---

## 一、核心结论：你说的「39 条仅设计收割」是过时快照

你提到的「39 条仍是仅设计收割——65% 已准入能力无实现」，对应的是 **2026-09-06 五轮执行之前** 的台账状态。本轮（09-07）我对权威台账 `dsh-codex-ledger/coverage.yaml` 做了逐条核对，并**实跑了全部 10 个包的测试套件**，结论如下：

| 指标 | 你记忆中的状态（09-06 前快照） | 2026-09-07 实测现状 |
|---|---|---|
| design-only 条目数 | 39 | **0**（已准入能力 0 条仅设计收割） |
| implemented | 3 | 7 |
| distilled | 18 | 46 |
| 已准入能力「有可运行实现」占比 | 你估 35% | **100%**（7 implemented + 46 distilled） |
| 全量测试 | — | **211 passed / 0 failed**（10 包） |

**你列出的模块分解，已在 09-06 四/五轮落地为 distilled（带测试）：**
- **session-kit（你记 9 条缺口）**：file-search / message-history / rollout-trace / thread-store / ext-memories / ext-history-notes / agent-graph / structured-memory / replay —— 全部已蒸馏并各自有测试（src 下 15 个文件、5 个测试文件、27 测试）。
- **config-importer（你记 15 条、仅 3 配置键）**：features / terminal-detection / stream-parser / fuzzy-match / path-uri / path-utils / string / template / cache / home-dir / absolute-path / json-to-toml / readiness / redacted-string / git-discovery / context-fragments / response-debug-context —— 共 17 个蒸馏件（utils 全家 + 配置键三件套），18 测试。
- **prompts（你记 2 条）**：guardian-v2 双缝提示词、collaboration 模板 —— 均已落账（6 测试）。
- **schema（你记 1 条 extension-api）**：extension-api 运行时守卫已实现（17 测试覆盖四协议面）。
- **sandbox-bin（你记 5 条）**：diagnostics / sandbox-summary 已 implemented；bwrap / shell-escalation / process-hardening 经核实为 **vendor 二进制内嵌行为、无独立 JS 面** → 09-07 改判 `EXCLUDED/E5-vendor-binary`，不再算作「未完成的 JS 能力」。

**所以：真实剩余缺口不是 39，而是 0 条「已准入但无实现」。你感知到的缺口，绝大多数已经被前面几轮消化。**

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

> **PHASE2 清单至此全部收口**：P0-1/P0-2/**P1-1（全，含 parse_command 全量 bash 文法）**/P1-2/P1-3/P1-4/P2-2 均已执行并有机器证据（P1-1 的最后一块拼图 `parse_command` 已在本日续作中闭环，证据见下表与第六节）。P2-1/P2-3/P2-4 维持产品/环境决策类原状。

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
| 台账无遗漏 | GitHub trees API 取 v0.153.4 完整树（**7,837 路径，truncated=false**），按 `Cargo.toml` 还原 crate 集合 | 上游 **149 crates**，台账 **NEW-UNREGISTERED = 0** |
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

- **上游 12 提交已增量审阅并继续执行（2026-09-08 01:4x +08:00）**：`f3f53ee..adee0b0` 的逐提交裁决见 `dsh-codex-pack/docs/UPSTREAM-12-COMMIT-REVIEW.md`。daemon updater/release pins、Rust recursion limit、Unix zombie PID backend 排除；selected-history internal fork、archive scan、Guardian retained authorization 等因本地缺真实 runtime/consumer 保持阻断。选择有真实持久图 seam 的 `d665e3bbc` 落地：`AgentNode` 可持久 full `agentPath`，`formatEnvironmentContextSubagents()` 在重开 JSONL 图后同时列出 loaded/unloaded 直接 children，loaded 优先、组内按 full path 确定排序，并按 parent path 前缀严格拒绝缺 parent path、跨 parent path 与直接链接的 grandchild；重复 edge 去重，且按上游 envelope 限制 **8 agents / 1,024 bytes**。只读代码复核发现并推动补齐上述 direct-child path invariant；另新增转义扩张 + UTF-8 多字节的 **1,024/1,025 精确边界**测试，证明 wrapper/indent/newline 与 XML escaping 均计入字节预算。公开 package runtime export 并重建 **9.8 kB** ESM bundle，smoke `v2-roster-bundle-smoke: OK`。session-kit **38/38**，定向 strict TypeScript **0 错误**。pack preflight **7 sibling modules OK**，最终 dry-run **24 files / 20.2 kB packed / 58.4 kB unpacked**，台账 YAML/JSON **150/150 语义一致**，`git diff --check` 通过（仅 CRLF 转换 warning）。这是 host 可调用的纯 roster 算法，尚未接入 DSH world-state/prompt，不能宣称 multi-agent runtime 已完整移植。

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
