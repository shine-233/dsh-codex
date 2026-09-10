# 合并收口独立复核报告

日期：2026-09-09 22:40
被复核对象：`dsh-codex-monorepo` main = `d40dcb9`（基线 `7ce2d73`）

## 1. 本轮做了什么

09-08 给出的「B → A → C」合并顺序建议，在 09-09 期间已由并行会话执行完毕：A(`ac749fe`)、B(`f2cf49d`) 均已是 main 祖先（双向 `merge-base --is-ancestor` 为 YES），C 线内容也已落在 main 上，`1f867fc` 还补上了 bundle 重建脚本与 CI 门禁。

因此本轮**不是重复合并**，而是对合并结果做一次独立复核，并把复核中发现的漏网项补掉。

## 2. 复核结果

| 项目 | 结果 | 说明 |
|---|---|---|
| 关键修复在位 | ✅ | `evaluateCached(policy, line, approvalCache)`、`seekSequence(..., eof, 'NormalizeToLf')`、shellParser 逐 invocation substitutions 三项全在 |
| typecheck | ✅ 10 包全过 | 其中 4 包需借 `@types/node`（见第 4 节），非代码缺陷 |
| 测试（vitest 4.1.11） | ✅ 37 files / 392 tests 全绿 | 分布 24 / 18 / 3 / 165 / 6 / 4 / 35 / 38 / 21 / 78 |
| bundle 一致性 | ✅ 10 包 0 drift | 修复后口径，见第 3 节 |

## 3. 发现并修复的两处漏网

### 3.1 `5acf49c` — dsh-codex-pack 的 bundle 与源码漂移

`a78782e`（"从合并后源码重建 bundles"）漏掉了 `dsh-codex-pack`。该包源码与产物已经不一致：

- `src/profileWriter.ts:99`：先置 `packageReplaced = true`，再 `ops.rename(...)`
- 已入库 `lib/index.js`：先 `ops.rename(...)`，再置标志

后果是真实的：`ops.rename()` 抛异常时，旧顺序下标志尚未置位，回滚逻辑（`if (packageReplaced) ops.copy(packageRollback, packageJsonPath)`）不会执行；新顺序则已经把标志置上，回滚照常进行。已按当前 `src/index.ts` 重建（+2/−2 行），重建后 diff 为 0。

### 3.2 `f5e7310` — 门禁枚举漏掉 pack

`scripts/rebuild-bundles.mjs` 按「有 `src/dsh-plugin.ts`」枚举包，而 `dsh-codex-pack` 只有 `src/index.ts`，因此**从未被校验** —— 这正是 3.1 的漂移能躲过 `a78782e` 整仓重建的原因。

改为按「有 `src/` 且有 `lib/index.js`」枚举，并让入口回退到 `src/index.ts`：

- 覆盖：9 包 → **10 包**
- `dsh-codex-ledger` / `dsh-codex-ui` 仍排除：二者无 `src/`，`lib/index.js` 是手写 JS 而非 esbuild 产物，纳入会误报
- 回归验证：`--check` 10 包 0 drift；write 模式往返为 no-op

## 4. 环境与验证方法（本机限制下的可行路径）

本机无外网，`main` 的 `node_modules` 与 `package.json` 声明不同步（声明 vitest 4.1.11，实际装的是 2.1.9；多数包缺 `@types/node`），`pnpm install` 被沙箱拦截。因此验证全部借用 worktree 里已装好的工具链：

| 需要 | 借法 |
|---|---|
| esbuild 0.25.12 | `.claude/worktrees/objective-mccarthy-aaeff0/<pkg>/node_modules/@esbuild/win32-x64/esbuild.exe`，经脚本 `--esbuild <绝对路径>` 传入 |
| vitest 4.1.11 | `cd <worktree>/<pkg> && node node_modules/vitest/vitest.mjs run --root <main 对应包的绝对路径>` |
| @types/node 22.20.1 | `tsc --noEmit --typeRoots <worktree>/<pkg>/node_modules/@types --types node` |
| bundle 打包参数 | `<entry> --bundle --format=esm --platform=node --packages=external`，**必须在包目录内执行**（esbuild 的源路径注释相对 cwd，从仓库根跑会全仓假漂移） |

**用 vitest 2.1.9 跑 main 的结果不可信**（与声明的 4.1.11 不一致），这一点在后续任何验证中都要注意。

## 5. 路线图遗留项收口（2026-09-09 晚）

对照 ROADMAP 第八节「下一步执行顺序」与第九节，本轮补收三项：

1. **`d40dcb9` — CI 增加 per-package typecheck job**：10 个包都声明了 typescript 5.9.3 与 `typecheck` 脚本，但 CI 原本只有 `test` 与 `bundles` 两个 job，类型错误只能靠人工跑 tsc 才会暴露（policy-engine 的 33 项欠账、schema 的漂移都是这么发现的）。新增与 test 同构的 10 包 typecheck matrix。
2. **同一提交补齐 `codex-config-importer`**：它是唯一既无 `typecheck` 脚本、也无 typescript devDependency 的包，加进 CI 会被静默跳过；已补齐，并把 `@types/node` 从 `^22` pin 成 `22.20.1` 与其余 9 包对齐。lock 用 `pnpm install --lockfile-only --offline` 重生成；**10 包 `--frozen-lockfile` 检查全部通过**，所以 CI 的 install 步骤不会挂。
3. **pack 复验**：preflight **7 sibling modules OK**，`npm pack --dry-run` **25 files / 25.4 kB packed / 74.0 kB unpacked** —— 与第九节记录一致，说明 3.1 的 bundle 重建没有影响打包。

### 仍未收口（需外部条件或授权）

| 项 | 状态 |
|---|---|
| 推送 | **ahead 20 / behind 0，未 push**，等你授权 |
| npm audit 的 5 项 dev-only advisory | B 线已把 vitest 升到 4.1.11 / vite 6.4.3，理论上覆盖了其中的 Vitest UI / Vite dev-server 问题，但**本机无外网跑不了 `npm audit`，未做版本级核验**，建议在有网环境补一次再结案 |
| 上游 `adee0b0` 之后的新提交 | 第九节已闭环 `121f91f..adee0b0` 的 29 个非 merge 提交审计；本轮未再取新上游（无外网） |

## 6. 状态与建议

- main = `d40dcb9`，相对 `origin/main` **ahead 20 / behind 0**，**未推送**（等授权）。
- 工作树仅剩并行会话对 `ROADMAP-2026-09-07-PHASE2.md` 的未提交改动，本轮未触碰。
- 建议：换机或跑 CI 前先做一次正常的 `pnpm install`，让 `node_modules` 与声明对齐，否则本地任何 vitest / typecheck 结论都要打折扣。
