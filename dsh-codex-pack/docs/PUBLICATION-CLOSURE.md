# 发布闭包（publication closure）

本文件记录 `dsh-codex-pack` 及其 8 个组件的**发布闭包**当前状态，以及四种安装证明路径的区分。
对应验收门：「区分 sibling-lib activation、clean registry install、offline multi-tarball、offline single-tarball；
不得用 custom importer 证明发布闭包」。

## 四种路径

| # | 路径 | 状态 | 证据 |
|---|---|---|---|
| 1 | sibling-lib activation | ✅ 已实现，但**明确标记不是发布闭包** | `buildInstallPlan()` 返回 `mode: 'sibling-lib'`、`publicationClosure: false` |
| 2 | offline multi-tarball | ✅ 已闭环 | `dsh-codex-pack/test/offlineClosure.test.ts` |
| 3 | offline single-tarball | ✅ 已闭环 | 同上 |
| 4 | clean registry install | ⛔ **blocked** | 见下 |

### 1. sibling-lib activation（开发路径）

`buildInstallPlan()` 把每个依赖解析到同级源码目录。它只用于开发，**不能**代替发布证明：
它不经过 `npm pack`，不检查 `files`，也不验证 tarball 完整性。因此计划对象显式携带
`mode: 'sibling-lib'` 与 `publicationClosure: false`，任何把它当作发布证据的用法都会在断言处失败。

### 2. offline multi-tarball（已闭环）

对 9 个包各执行一次真实 `npm pack`，得到 9 个真实 npm tarball；随后在一个干净目录中以
`file:` 规格执行 `npm install --offline`。断言：

- 每个 tarball 含 `lib/index.js` 与 `cordis.patch.yml`；
- 不含 `test/`、`node_modules/`、lockfile；
- `src/` 仅在包自身 `exports['.'].types` 指向 `./src/` 时才随包发布（`codex-edit-fusion` 属于此例），
  其余包不发布 `src/`；
- 安装后每个包的 built entry 存在且可加载；
- 安装后的 pack 仍能通过 `validatePackLayout`（0 错误）。

### 3. offline single-tarball（已闭环）

用一个**暂存副本**（不修改仓库内 `package.json`）声明 `bundleDependencies` 为 8 个组件，
先安装再 `npm pack`，产出一个内联了全部组件的单一 tarball。断言该单一产物内部确实含有
每个组件的 `lib/index.js`，并在干净目录中以 `npm install --offline` 安装后全部可解析。

> 该测试曾抓到一个真实缺陷：暂存时若整体替换 `dependencies`，会丢掉 pack 自身的 `js-yaml`
> 运行时依赖，导致聚合产物对消费者不可用。现已改为合并，并由断言守卫。

### 4. clean registry install（⛔ blocked）

2026-09-11 复核（只读 `GET https://registry.npmjs.org/<name>`）：

```
dsh-codex-pack        404
codex-policy-engine   404
codex-edit-fusion     404
codex-config-importer 404
codex-prompts         404
codex-session-kit     404
codex-net-guard       404
codex-schema          404
codex-skills-kit      404
```

**9/9 未认领**。因此「clean registry install」无法验证：包尚未发布，且**未经显式授权不执行发布**。
本仓库的离线闭包已闭环，但这不等于 registry 闭包；在所有权与最终 identity 解决之前，
该路径保持 **blocked**。

## 关于 `--legacy-peer-deps`

离线安装测试使用 `--legacy-peer-deps`：所有 `@deepseek-ai/dsh-*` 服务由 DSH host 提供，
不由这些包自行安装（`codex-edit-fusion` 早已以 `peerDependencies` 表达这一关系；
`codex-session-kit` 的同类依赖也已从 `dependencies` 迁到 `peerDependencies` 以保持一致）。
被测闭包是 **codex 包自身的可安装性**，不是 DSH 的。

相应地，加载断言允许两种结果：加载成功则校验插件面（`apply`/`name`/`inject`，
聚合包校验 `validatePackLayout`/`buildInstallPlan`）；加载失败则**只允许**因缺少
host 提供的 `@deepseek-ai/dsh-*` 而失败（`ERR_MODULE_NOT_FOUND` 且消息含 `@deepseek-ai/dsh-`）。
任何其他失败都是真实的闭包缺陷。

## 关于离线安装对 npm 缓存的前置要求

路径 2 / 3 的安装步骤是 `npm install --offline`：它**不联网、不解析 registry**，只从
`~/.npm/_cacache` 取包。因此运行这两条用例之前，闭包里的全部非 `file:` 依赖必须已在缓存中，
否则会在断言之前就死掉：

```
npm error request to https://registry.npmjs.org/@standard-schema%2fspec
failed: cache mode is 'only-if-cached' but no cached response is available.
```

CI 的 test 作业用 `pnpm install` 装依赖，只填充 pnpm store，**不写 npm 缓存**，所以在干净
runner 上必须显式预热。仓库根目录的脚本负责这件事，依赖集合从各包 `package.json` 的
`dependencies`（仅运行时依赖；离线安装带 `--legacy-peer-deps` 且不装 devDependencies）派生：

```
node scripts/warm-npm-cache.mjs
```

CI 中该步骤只在 `dsh-codex-pack` 这一矩阵项上执行。本地首次运行这两条用例前也要先跑一次；
缓存在后续运行中复用，无需重复预热。

## 发布前仍待解决

- 9 个未认领 identity 的所有权与最终命名（含是否需要 scope）；
- `files` 白名单目前按包手工维护，`codex-edit-fusion` 因 `types` 指向 `./src/index.ts`
  而仍发布 `src/`；若后续产出 `.d.ts`，应移除该例外。
