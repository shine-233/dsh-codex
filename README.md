# dsh-codex · openai/codex → DeepSeek Harness 移植 monorepo

把 openai/codex 里经过实战检验的能力移植进 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的插件体系。原先拆成 12 个微仓，2026-08 合并为单一 monorepo：一次 clone 拿到全部模块，跨模块改动一个 PR 收口。

## 模块地图

| 目录 | 原仓库 | 职责 |
|---|---|---|
| `dsh-codex-ledger/` | dsh-codex-ledger | 移植台账与总控：coverage.yaml 台账、差分校验脚本、迁移总计划 |
| `codex-schema/` | codex-schema | 线协议契约：openai/codex wire protocol 的 TS 类型 + zod |
| `codex-config-importer/` | codex-config-importer | config.toml → cordis.patch.yml 一次性迁移器 + 公共小工具 |
| `codex-prompts/` | codex-prompts | 实战提示词资产（提取 / 压缩 / 审查） |
| `codex-skills-kit/` | codex-skills-kit | 技能目录预算渲染 + 词法自动选择 |
| `codex-sandbox-bin/` | codex-sandbox-bin | 跨平台沙箱工具（vendor 自 openai/codex，Apache-2.0） |
| `codex-net-guard/` | codex-net-guard | agent 沙箱网络白名单代理（纯 JS） |
| `codex-session-kit/` | codex-session-kit | 会话导入 / 回放 / 记忆套件 |
| `codex-edit-fusion/` | codex-edit-fusion | fuzzy_sequence 模糊匹配补丁引擎 × dsh 原子写入融合 |
| `codex-policy-engine/` | codex-policy-engine | 命令审批安全引擎：Starlark execpolicy + tree-sitter 命令分类 |
| `dsh-codex-ui/` | dsh-codex-ui | 已吸收能力的 UI dashboard |
| `dsh-codex-pack/` | dsh-codex-pack | 集成装配：把全部模块接进 Cordis，生成 dsh 文件 |

## 快速上手

- **看进度 / 对账** → `dsh-codex-ledger/MIGRATION_PLAN.md` 与 `dsh-codex-ledger/coverage.yaml`
- **一键装进 dsh** → `dsh-codex-pack/`
- **校验移植覆盖** → `python dsh-codex-ledger/scripts/verify_coverage.py`

## 历史

各目录由 `git subtree add` 合入，提交历史完整保留。查询单模块历史：

```sh
git log --follow -- dsh-codex-ledger/
```

原 12 个独立仓库已归档为只读，内容与本库一致。

## 许可证

各目录许可证以目录内 LICENSE / NOTICE 为准；其中 `codex-sandbox-bin/` 内含 vendor 自 openai/codex 的代码（Apache-2.0）。
