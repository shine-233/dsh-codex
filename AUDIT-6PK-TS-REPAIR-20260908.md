# 六包 TypeScript 5.9.3 修复 — 跨包 Diff 审计

日期：2026-09-08 21:40
审计对象：worktree `.claude/worktrees/modest-panini-0fb73e`（分支 `claude/modest-panini-0fb73e`，基线 `7ce2d73`）
接手背景：上一会话在"最终跨包 diff 审计"步骤因 API 额度 403 中断，本轮补齐该审计并独立复验。

## 1. 结论

**通过，可提交。** 25 项变更全部落在指定的 6 个包内，无 scope drift；依赖改动最小化且未波及 Vitest/Vite；3 处真实运行时缺陷已修复且已同步到 `lib/` 产物；六包 typecheck 0 错误、227 个测试全绿。

## 2. 范围核对（无 drift）

| 包 | 变更文件 | 是否越界 |
|---|---|---|
| codex-edit-fusion | lib/index.js, package.json, pnpm-lock.yaml, src/dsh-plugin.ts | 否 |
| codex-net-guard | package.json, pnpm-lock.yaml, src/dsh-plugin.ts | 否 |
| codex-policy-engine | lib/index.js, package.json, pnpm-lock.yaml, src/dsh-plugin.ts, src/shellParser.ts, test/shellParser.test.ts, test/dsh-plugin.test.ts(新) | 否 |
| codex-sandbox-bin | package.json, pnpm-lock.yaml, test/sandboxSummary.test.ts, tsconfig.json | 否 |
| codex-session-kit | package.json, pnpm-lock.yaml, src/agentGraph.ts, src/dsh-plugin.ts | 否 |
| codex-skills-kit | package.json, pnpm-lock.yaml, src/dsh-plugin.ts | 否 |

合计 24 改 + 1 新增 = 25 项，+496 / -186。未触碰 ROADMAP、ledger、schema、config-importer，也未触碰 Vitest/Vite 迁移相关的任何文件。

## 3. 依赖审计

- 新增（6 包一致）：`typescript: 5.9.3`、`@types/node: 22.20.1`（精确 pin，可复现）。
- `codex-net-guard` / `codex-session-kit`：`@types/node` 由 `^22` 收紧为 `22.20.1`。属于把"可复现"落到实处的必要收紧，非版本升级。
- **无 Vitest/Vite 升级**：lockfile 中 `vitest@2.1.9`、`vite@5.4.21`、`@vitest/mocker@2.1.9`、`vite-node@2.1.9` 版本均未变，仅 peer 后缀变为 `(@types/node@22.20.1)`。独立迁移线未被污染。
- `codex-sandbox-bin/tsconfig.json`：移除 `typeRoots: ["../dsh-codex-pack/node_modules/@types"]`。全仓 grep 确认这是**最后一处**跨包 typeRoots 耦合，现已清零，解除了对兄弟包 node_modules 的隐式依赖。

## 4. 运行时语义变更（非纯类型，共 3 处）

1. **codex-policy-engine — approvalCache 从未被使用（真实缺陷）**
   `evaluateCached(policy, line)` → `evaluateCached(policy, line, approvalCache)`。
   旧代码创建了 `approvalCache` 但从不传入，缓存是死代码；同时 `evaluateCached` 内部改为 `cache.get(key)`（cache 变必选参数），调用点必须同步，否则会抛错。已新增 `test/dsh-plugin.test.ts` 的 spy 回归用例锁死该行为。
2. **codex-edit-fusion — seekSequence 调用签名不匹配（真实缺陷）**
   `seekSequence(lines, pattern, start)` → `seekSequence(lines, pattern, start, eof, 'NormalizeToLf')`。补齐了 eof 与换行归一化参数。
3. **codex-policy-engine/shellParser — 每 invocation 的 shell substitutions**（配合控制符边界重置），属于分类能力补齐，已随 `shellParser.test.ts` 新增 9 行用例覆盖。

其余全部为 unknown-first 宿主边界类型化、类型断言、等价重构（`args?.x ?? d` → `asRecord(args).x ?? d`），运行时字节码不变。

## 5. 生成产物（lib/index.js）一致性

`lib/index.js` 是 esbuild 单文件 bundle（含 `dsh-plugin.ts` 内容），已入库、且是 package `main`。四个包改了 src 但未重建 lib，逐一定性：

| 包 | src 是否含运行时变更 | lib 现状 | 判定 |
|---|---|---|---|
| codex-edit-fusion | 是（第 2 条） | 已重建（+37 行） | 一致 |
| codex-policy-engine | 是（第 1、3 条） | 已重建（+45 行） | 一致 |
| codex-skills-kit | 形式上变了：`renderCatalog(entries)` 不再 map 掉 `aliases` | 未重建 | **实证等价**：`renderCatalog` 只读 `name`/`description`（src/index.ts:34-40）；临时测试在 budget=10/50/200/10000 下比对带/不带 aliases 输出，结果全等（测试已删） |
| codex-net-guard | 形式上变了：`render` 由 `text: v` 改 `text: String(value)` | 未重建 | **等价**：execute 全部分支返回 `JSON.stringify(...)`，v 恒为 string，`String(v) === v` |
| codex-session-kit | 否（纯类型） | 未重建 | 一致 |
| codex-sandbox-bin | 否（仅测试 import 补 `.js`） | 未重建 | 一致 |

## 6. 复验结果（本轮独立执行）

```
typecheck (tsc --noEmit × 6)：全部 0 错误
vitest run：
  codex-edit-fusion   2 files / 10 tests   ✓
  codex-net-guard     1 file  /  3 tests   ✓
  codex-policy-engine 8 files /155 tests   ✓
  codex-sandbox-bin   2 files /  4 tests   ✓
  codex-session-kit   7 files / 34 tests   ✓
  codex-skills-kit    3 files / 21 tests   ✓
  合计 23 files / 227 tests，0 失败
```
（本地无 esbuild、无外网，故 lib 未做机械重建，改用等价性实证，见第 5 节。）

## 7. 遗留与建议

1. **lib 无构建脚本、无 CI 校验**：全仓仅 `codex-schema` 有 `build`，六包 lib 依赖人工 esbuild。建议补一个 `pnpm run build`（esbuild bundle）并在 CI 里做"重建后 diff 必须为空"的门禁，否则 lib 漂移必然复发。
2. **三处并行未提交工作，均基于 7ce2d73，存在冲突面**：main 工作树 47 项（config-importer/pack/schema/ledger 线）、objective-mccarthy 42 项、modest-panini 25 项。建议先落 modest-panini（改动面最小、最独立），再按序处理另外两条。
3. **依赖 pin 策略**：`@types/node` 混用 `^22` 与 `22.20.1`，建议后续统一（本次仅按最小改动原则未扩大范围）。
