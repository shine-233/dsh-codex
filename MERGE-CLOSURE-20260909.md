# 三条线合并收尾报告

日期：2026-09-09 08:00
仓库：`active/dsh-codex-monorepo`，共同基线 `7ce2d73`

## 1. 现场与预期不同（重要）

原计划按 B → A → C 顺序合并。实际接手时发现**并行会话已于 09-08 22:04–22:09 完成大半**：

- C 线（业务功能）已拆成 6 个提交落到 main：`59bb676` → `4f7fbc9` → `288064c` → `9b85bf2` → `d1055ce` → `c824f02` → `cea1aa0`
- B 线（vitest/vite 迁移）提交为 `f2cf49d`，并已 merge 进 main（`104ddc4`）
- A 线（`ac749fe`）的内容被**手工复制到 main 工作树并 stage**，但没有提交（16 项已暂存、4 项未暂存），且这种方式绕过了 git 的合并历史

我的处理：`git reset` 掉手工暂存的内容（先 `git diff --cached` 落档），恢复干净工作树，改用真正的 `git merge ac749fe`，保留完整合并历史。手工搬的那批改动与 `ac749fe` 内容等价，无信息丢失。

## 2. 冲突解决（19 个文件）

**依赖层（12 个）**
- 6 个 `package.json`：保留 B 的 `vite 6.4.3` / `vitest 4.1.11`，采纳 A 的 `@types/node` pin。policy-engine 例外，保留 main 的 `26.4.1`（本地已装，改 pin 会让 lock 失配）。
- 6 个 `pnpm-lock.yaml`：**全部用 `pnpm install --lockfile-only --offline` 合并**，未手工解。pnpm 能自动解决 lock 冲突（`Merge conflict detected in pnpm-lock.yaml and successfully merged`），离线可用。

**源码（5 个）**

| 文件 | 决策 |
|---|---|
| `codex-edit-fusion/src/dsh-plugin.ts` | **手工合并**：保留 C 的原子写事务 + moveTo/delete + `root` 配置，采纳 A 的 `seekSequence(lines, pattern, start, eof, 'NormalizeToLf')` 修复与 unknown-first 参数处理 |
| `codex-session-kit/src/agentGraph.ts` | 保留 C 的 multi-agent roster 常量 + `escapeXmlAttribute`，采纳 A 的判别联合 `AgentGraphOperation`（op 只有 node / edge / edge-status 三种，联合类型完全覆盖） |
| `codex-policy-engine/src/dsh-plugin.ts` | **取 main**：C 的 seam 更丰富（ExtensionDecisionAdapter、ExtensionRuntimeObserver、evidence log），A 的类型化是等价但更弱的重复实现 |
| `codex-policy-engine/src/shellParser.ts` | 取 main：与 A 是同一功能（逐 invocation substitutions）的两种命名，main 侧已通过验证 |
| `codex-policy-engine/test/dsh-plugin.test.ts` | add/add：取 main 版本；A 的缓存回归用例单独落成 `test/approvalCache.test.ts` |

**产物（2 个 lib）**：用 esbuild 从合并后的源码重建（见第 3 节）。

## 3. lib 重建（顺带查出两个既有缺陷）

本机没有可用的 esbuild，但**可以从 worktree 里借**（`.claude/worktrees/objective-mccarthy-aaeff0/*/node_modules/@esbuild/win32-x64/esbuild.exe`，0.25.12）。

各包真实 bundle 入口是 `src/dsh-plugin.ts`（每个包的 dsh-plugin 都 re-export 了自己的 index 表面）。重建前后逐个比对导出名，确认无丢失。发现：

- **`codex-skills-kit` 的已提交 lib 缺了整个 selector 模块** —— `selectSkills` 根本没被导出，属于严重产物漂移。
- **`codex-policy-engine` 的已提交 lib 过时** —— 其 shellParser 输出 `substitutions: []`（空数组），且缺 canonicalization 的一段。
- `codex-session-kit` 缺 `isToolHost`，并残留旧 esbuild 产生的两条空语句 `filePath;`。
- net-guard / sandbox-bin 仅类型层面变化。

六个包的 lib 现已全部与源码同步。

## 4. 验证

- **typecheck（TS 5.9.3）**：A 覆盖的六包全部 0 错。（main 的 node_modules 没装 typescript/`@types/node`，借 objective-mccarthy 的 tsc 与 policy-engine 的 `@types` 交叉跑的。）
- **测试 vitest 2.1.9（main 本地）**：10 包 / 37 文件全绿。
- **测试 vitest 4.1.11（交叉，用 objective-mccarthy 的 vitest 指 `--root` 到 main）**：edit-fusion 18、policy-engine 165、session-kit 38、skills-kit 21、net-guard 3、sandbox-bin 4，全绿。
- 新增 `test/approvalCache.test.ts`（2 用例）锁住 canonical 缓存：两个等价 shell wrapper 只触发一次 `Policy.check()`。第一版硬编码了缓存 key `'echo hi'`，在 main 的 canonicalization 下不成立，已改为断言不变量而非 key 形式。

## 5. 提交

| commit | 说明 |
|---|---|
| `b066b9b` | `merge: bring the TypeScript 5.9.3 six-package repair onto main`（真正的三方合并，保留历史） |
| `476bc14` | `test(policy-engine): assert canonical cache sharing without hardcoding keys` |
| `a78782e` | `build: rebuild the remaining codex-* bundles from the merged sources` |

main 工作树已干净（只剩两份未跟踪的审计 md）。**未 push**（等你授权）。

## 6. 遗留

1. **`codex-config-importer` 与 `codex-prompts` 仍有 5+5 个隐式 `any`**（TS7006），typecheck 红。这是 C 线新增文件未类型化的既有缺口，不在 A 的范围内，本次未动。
2. **并行会话的 WIP 已归档**：合并前清理工作区时，有 3 个未提交文件（config-importer/src/dsh-plugin.ts、prompts/src/dsh-plugin.ts、prompts/test/guardian.test.ts）被 revert，连同当时的暂存内容一起备份到 `.workbuddy/wip-dsh-20260909/`（含 `unstaged-20260909.patch`、`staged-20260909.patch` 与原始文件副本）。要不要恢复由你决定。
3. **lib 依旧没有 build 脚本与 CI 门禁**。本次能重建纯属借到了 worktree 里的 esbuild；正常路径应该是各包加 `build: esbuild src/dsh-plugin.ts --bundle ...` + CI「重建后 diff 必须为空」。沙箱无外网、`pnpm install` 被 wmic 黑名单拦掉，我没法在本地把 esbuild 装进各包，所以这项没做。
4. main 的 `node_modules` 与 `package.json` 不同步（声明 vitest 4，本地仍是 vitest 2）。跑 CI 或换机前需要一次正常的 `pnpm install`。
