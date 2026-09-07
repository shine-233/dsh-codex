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

> **PHASE2 清单至此全部收口**：P0-1/P0-2/P1-1（半）/P1-2/P1-3/P1-4 均已执行并有机器证据；唯一缓议 = P1-1 全量 bash 文法（无上游源码，忠实度不可机器校验）。P2 系列维持产品/环境决策类原状。

---

## 三、仍存在的「真实」工作（按优先级）

下面这些**不是** design-only，而是「已蒸馏但部分子面未移植」或「环境/产品决策类」缺口。它们才是下一阶段该啃的硬骨头。

### P0 · 立即可做、可验证
| # | 项 | 现状 | 动作 |
|---|---|---|---|
| P0-1 | **session-kit SessionIndex 在本环境不可验证** | `node:sqlite` 未编入当前 Node 22.22.2，`rebuilds and searches` 测试 `node:sqlite unavailable; skipping` → 会话镜像**实测未覆盖** | **✅ 已执行（见二.4）**：重构为可插拔存储 + 纯 JS 回退 + `close()` 释放 sqlite 句柄，测试去掉 skip 后真实跑通 |
| P0-2 | **linux-sandbox musl 自建** | ✅ **已执行（2026-09-07）**：处置 = **正式冻结 vendor 0.149**（二进制实测 49,198,120 bytes / sha256 冻结基线 `d77ef2bf…b3a14` 已记台账；上游 0.153.4 不再附带资产，无新版可跟进；本沙箱无 Rust/musl 工具链与网络，不伪造自建）。重启条件 ①具备 Rust/musl 环境按 BUILD.md 自建 ②上游恢复附带资产；重建须与基线 hash 比对。Windows 侧维持 09-06 刷新的 0.153.4 时代二进制 | 待有 Rust/musl 构建环境时自建，或正式声明停更 vendor（0.149）并写入台账 |

### P1 · 深化部分蒸馏（需立项，中等工作量）
| # | 项 | 未移植子面 | 价值 |
|---|---|---|---|
| P1-1 | **shell-command / policy-engine** | `parse_command` 全量 bash 文法 + `shell_detect` 提权选路 | ✅ **提权选路半已执行（2026-09-07）**：`commandSafety.detectEscalation` 路由 sudo/doas/pkexec/gsudo/elevate/runas + su -c（含选项参数跳过），2 新测试，policy-engine 45/45 绿。`parse_command` 全量 bash 文法**维持缓议**：本机无上游 rust 源码，2,766 行全量移植无法机器校验忠实度，强行移植即造假 |
| P1-2 | **ext/skills dynamic_skill_selector** | ✅ **已执行（2026-09-07）**：`selectSkills`/`resolveAlias`/`buildAliasIndex`/`normalizeToken` 别名解析+词法打分蒸馏落地，+11 测试，skills-kit 21/21 绿；注册 `codex_skill_select` dsh 工具（注入缝） | 提升技能自动选择的命中率 |
| P1-3 | **rollout 持久化度量** | ✅ **已执行（2026-09-07）**：`rolloutMetrics.ts` 落地 ordinal/持久化/压缩度量（total/uncompressed/compressed/totalBytes/savedBytes/savedPct/ordinal/persisted），+3 测试，session-kit 34/34 绿；台账 rollout 条目同步 | 会话日志的可观测性与增量回放 |
| P1-4 | **thread-store 持久后端** | ✅ **已执行（2026-09-07）**：`JsonlFileThreadStore` JSONL 落盘后端（线程+队列双文件、跨进程 durable、坏行容忍、零原生依赖）+ `createThreadStore` 工厂（file→durable，默认内存），+4 测试；sqlite 后端按需另立项 | 若 dsh 需要跨进程 durable thread，需补一个后端（file/sqlite） |

### P2 · 产品/环境决策类（非移植缺口，按需）
| # | 项 | 说明 |
|---|---|---|
| P2-1 | **vendor 二进制行为（bwrap/shell-escalation/process-hardening）** | 已改判 E5。若 dsh 想要原生对等能力（不依赖 vendor exe），属独立产品 epic，不在 codex 移植范围内 |
| P2-2 | **codex-schema protocol 草图 M1→zod 正式形状** | 当前手写守卫为 `@ts-nocheck` 子集 + 零依赖三元组校验；可升级为 zod 校验（需先在 schema 包显式声明 zod 依赖，避免幻影依赖） |
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
