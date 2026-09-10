# dsh-codex · openai/codex → DeepSeek Harness 移植 monorepo

把 openai/codex 里经过实战检验的能力移植进 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的插件体系。原先拆成 12 个微仓，2026-08 合并为单一 monorepo：一次 clone 拿到全部模块，跨模块改动一个 PR 收口。

## 模块地图

| 目录 | 原仓库 | 职责 |
|---|---|---|
| `dsh-codex-ledger/` | dsh-codex-ledger | 移植台账与总控：coverage.yaml 台账、差分校验脚本、迁移总计划 |
| `codex-schema/` | codex-schema | 线协议契约：openai/codex wire protocol 的 TS 类型 + zod |
| `codex-config-importer/` | codex-config-importer | config.toml 解析/迁移建议；尚未接入当前 DSH settings/provider ownership |
| `codex-prompts/` | codex-prompts | 实战提示词资产（提取 / 压缩 / 审查） |
| `codex-skills-kit/` | codex-skills-kit | 技能目录预算渲染 + 词法自动选择 |
| `codex-sandbox-bin/` | codex-sandbox-bin | 冻结的原生资产与状态清单；不是 DSH sandbox runtime |
| `codex-net-guard/` | codex-net-guard | agent 沙箱网络白名单代理（纯 JS） |
| `codex-session-kit/` | codex-session-kit | rollout 检查/转换与独立存储工具；尚非 durable DSH Session 导入 |
| `codex-edit-fusion/` | codex-edit-fusion | fuzzy_sequence 补丁解析/规划；当前物理写入尚未经过 DSH FS authority |
| `codex-policy-engine/` | codex-policy-engine | 命令审批安全引擎：Starlark execpolicy + tree-sitter 命令分类 |
| `dsh-codex-ui/` | dsh-codex-ui | 已吸收能力的 UI dashboard |
| `dsh-codex-pack/` | dsh-codex-pack | 集成装配：把全部模块接进 Cordis，生成 dsh 文件 |

## 快速上手

- **看迁移清单** → `dsh-codex-ledger/coverage.yaml`（153 个时序 row：7 implemented / 46 distilled / 100 EXCLUDED；这些标签只表示代码去向，不表示等效）
- **看当前证据 / 剩余硬门** → `dsh-codex-ledger/EVIDENCE_AUDIT_20260910.md` 与 `dsh-codex-ledger/MIGRATION_PLAN.md`（53 条正向记录中 0 runtime-equivalent；100 条当前排除记录已 100/100 精确源码裁决为 37 split / 13 blocked / 38 excluded / 12 migration-candidate）
- **装入一个聚合 bundle** → `dsh-codex-pack/`（8 个默认插件；sandbox 独立可选；当前只证明 source-tree activation）
- **校验迁移清单结构** → `python dsh-codex-ledger/scripts/verify_coverage.py --upstream <upstream-codex> [--revision <git-revision>]`（基于 exact Git object；不校验行为、测试或 runtime consumer）

`dsh-codex-pack` 的 profile writer 只添加本地依赖和一个 `dsh-codex-pack` bundle layer，不覆盖用户 `cordis.patch.yml`。当前 Loader 集成测试通过自定义 sibling importer 从提交的 `lib/index.js` 激活插件并调用只读 policy 工具；它不证明 clean registry install、offline single-tarball closure 或五个 host integration gate。MCP proof/auth epoch、remembered approval、Guardian retained authorization 和原生 sandbox 重建等无 DSH 消费面的能力仍明确阻断。

## 测试工具链

10 个含测试的模块分别维护自己的 `package.json` 与锁文件；当前统一精确固定为 Vitest 4.1.11 和 Vite 6.4.3，并都声明 TypeScript 5.9.3 的 `typecheck` 脚本。CI 使用 Node.js 24，以 frozen pnpm lock 安装后逐包运行测试与 typecheck，并单独运行提交 bundle 的 drift gate。更新依赖时须同步对应锁文件。

本次从 Vitest 2.1.9 升级是为修复 GHSA-5xrq-8626-4rwp 及相关 Vite/esbuild 公告。现有测试仅使用 `describe`、`it`、`expect`、生命周期钩子和 `it.each`，升级后语义不变；仓库也未启用受 Vitest 4 破坏性变更影响的 mock、snapshot、coverage、browser mode、自定义 worker pool/reporter 或全局 API。工具链最低要求变为 Node.js 20、Vite 6；Vitest 4 还收窄了默认测试排除规则，并重做了 worker pool 与部分高级 API。暂不采用刚发布且要求 Node.js 22.12+ 的 Vitest 5，以降低纯安全升级的迁移风险。

## 历史

各目录由 `git subtree add` 合入，提交历史完整保留。查询单模块历史：

```sh
git log --follow -- dsh-codex-ledger/
```

原 12 个独立仓库已归档为只读，内容与本库一致。

## 许可证

各目录许可证以目录内 LICENSE / NOTICE 为准；其中 `codex-sandbox-bin/` 内含 vendor 自 openai/codex 的代码（Apache-2.0）。
