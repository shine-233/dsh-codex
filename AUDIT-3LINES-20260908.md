# dsh-codex-monorepo 三条并行线 — 交叉审计与合并建议

日期：2026-09-08 22:05
共同基线：`7ce2d73`（build: rebuild codex-policy-engine lib…）

## 1. 总览

| 线 | 位置 | 改动 | 测试现状 | 状态 |
|---|---|---|---|---|
| A. modest-panini | worktree `claude/modest-panini-0fb73e` | 25 项（+496/-186） | 6 包 / 23 files / **227 tests** 全绿 | **已提交 `ac749fe`**（本次） |
| B. objective-mccarthy | worktree `claude/objective-mccarthy-aaeff0` | 42 文件（+7003/-6062） | 9 包 / 27 files / **320 tests** 全绿 | 未提交；**分支 ref 未落盘** |
| C. main 工作树 | `main` | 37 改 + 10 未跟踪 = 47（+3256/-719） | 6 包 / 28 files / **355 tests** 全绿 | 未提交 |

三条线各自健康，但**存在真实重叠**，不能简单叠加。

## 2. 各线内容定性

**A. modest-panini（已提交）** — TypeScript 5.9.3 可复现化 + 六包类型修复
- 依赖：pin `typescript 5.9.3` + `@types/node 22.20.1`（6 包）。
- 运行时修复：`evaluateCached` 补传 `approvalCache`；`seekSequence` 补 `eof` + `'NormalizeToLf'`；`shellParser` 逐 invocation substitutions。
- 清掉最后一处跨包 `typeRoots`。

**B. objective-mccarthy** — Vitest/Vite 安全迁移
- `vitest 2.1.9 → 4.1.11`、`vite → 6.4.3`（9 个包），CI 改为 `npm ci` / `pnpm install --frozen-lockfile` / `pnpm test`。
- lockfile 全量重写（每包 620–750 行）→ 这是 +7003/-6062 的主体。
- 附带 `shellParser` substitutions（与 A 同一功能）、`dsh-codex-pack/test/differential.test.ts` 调整。
- 已实测：vitest 4.1.11 与 vite 6.4.3 已安装，9 包全部跑通。

**C. main 工作树** — 业务功能推进
- `codex-config-importer`：tomlImporter + dsh-plugin + 测试 + fixtures。
- `codex-schema`：handwritten 五个类型文件修复。
- `dsh-codex-pack`：**新增** `src/preflight.ts`、`src/profileWriter.ts`、`scripts/`、`docs/`×3（DSH-RUNTIME-CAPABILITY-AUDIT、UPSTREAM-12/17-COMMIT-REVIEW）；lib +217 行。
- `codex-policy-engine`：**新增** `src/approvalEvidence.ts` + 对应测试；**已独立修复** `approvalCache` 传入（第 289 行，但签名为 `cache?` 可选）。
- edit-fusion（seekSequence/v4aParser/test）、session-kit（agentGraph/dsh-plugin/lib）、ledger coverage、ROADMAP。

## 3. 冲突面（合并前必须处理）

**热冲突（三/双线同时改）**

| 文件 | A | B | C | 说明 |
|---|---|---|---|---|
| `codex-policy-engine/src/shellParser.ts` | ✅ | ✅ | ✅ | **三线重叠**。A 与 B 的 substitutions 是同一功能的两种写法，必须二选一；C 的改动需另行确认是否也是同一处 |
| `codex-policy-engine/src/dsh-plugin.ts` | ✅ | — | ✅ | A 的 cache 必选 vs C 的 `cache?` 可选，语义需统一 |
| `codex-policy-engine/test/dsh-plugin.test.ts` | ✅(3 it) | — | ✅(7 it) | 同名新文件，需合并用例 |
| `codex-policy-engine/lib/index.js` | ✅ | — | ✅ | 产物，以最终源码重建为准 |
| `codex-edit-fusion/src/dsh-plugin.ts` / `lib/index.js` | ✅ | — | ✅ | A 已修 seekSequence 签名；C 未修但改了别处 |
| `codex-session-kit/src/agentGraph.ts` / `dsh-plugin.ts` | ✅ | — | ✅ | 重叠 |
| 六包 `package.json` + `pnpm-lock.yaml` | ✅(ts/types pin) | ✅(vitest4/vite6) | 部分 | **lockfile 必冲突**，不要手工解 |

**B 线独有的大面**：9 个包的 `.github/workflows/ci.yml`、`package-lock.json`、lockfile —— 与 A/C 的 lockfile 重叠。

**C 线独有**：config-importer、schema、pack（preflight/profileWriter/scripts/docs）、ledger、ROADMAP —— 与 A/B 基本不重叠，最容易先落。

## 4. 建议合并顺序

1. **先合 B（vitest/vite 迁移）**：基础设施层，覆盖范围最广，后合会导致 A/C 的所有 lockfile 作废重来。
2. **再合 A（类型修复，已提交 `ac749fe`）**：与 B 的 `typescript 5.9.3` pin 目标一致，冲突集中在 lockfile —— 直接 `pnpm install --no-frozen-lockfile` 重新生成，**不要手解**。
3. **最后合 C（业务功能）**：重叠最少，且 C 已包含 approvalCache 修复，与 A 合并时以 A 的必选-cache 版本为准（更严格，且有 spy 回归用例）。
4. 合并后对 `codex-edit-fusion`、`codex-policy-engine`、`codex-session-kit`、`dsh-codex-pack` **重建 lib bundle**（当前无 build 脚本，见第 5 节）。

## 5. 环境风险（必须知道）

- **worktree 分支 ref 不落盘**：本机 `refs/heads/` 下只有 `main`。A 线 `git commit` 返回成功、`update-ref` 也返回 0，但 ref 始终没写入，HEAD 变成 unborn。最终靠手工写 `.git/refs/heads/claude/modest-panini-0fb73e` 才恢复。**B 线目前正是这个状态**：HEAD 未出生 → 全仓 1009 个文件被误报成"新增"，`git status` 完全不可信。在 B 线提交前，先用 `git diff 7ce2d73` 拿真实改动面（本报告即用此法），提交后若 HEAD 变 unborn，按同样方式手工补 ref 文件。
- **lib 产物无门禁**：全仓无 build 脚本（仅 `codex-schema` 有），本地无 esbuild 且无外网 → 无法机械重建，只能人工同步。建议补 build 脚本 + CI「重建后 diff 必须为空」。
- **vitest 4 不兼容旧参数**：`--reporter=basic` 在 4.x 已移除，直接跑会报 `Failed to load custom Reporter`（B 线已验证，去掉该参数即可）。
