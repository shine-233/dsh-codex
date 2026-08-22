# dsh-codex-pack

> Integration index for the codex→dsh kit: 12 plugins that graft openai/codex battle-tested capabilities onto DeepSeek Harness.
> codex→dsh 套件的**总入口**：把 openai/codex 里经过生产验证的能力，做成 12 个可独立安装的 dsh 插件。

[![ci](https://github.com/shine-233/dsh-codex-pack/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 为什么存在

codex CLI 把几件事做到了极致：命令审批、模糊补丁编辑、会话格式、沙箱执行体、网络白名单、技能预算。这些能力不该被锁在一个产品里——本套件把它们逐个抽成小包，全部移植到 dsh 的插件体系（Cordis `name/inject/apply` 三件套）上，锚定上游 `openai/codex@970b7f2ff4f6`，季度 diff 跟进。

## 套件全家福

| 仓库 | 一句话 | 在 dsh 里的工具 |
|---|---|---|
| [codex-policy-engine](https://github.com/shine-233/codex-policy-engine) | 命令审批引擎（Allow/Prompt/Forbidden 规则树） | 接管 `tools/pre-execute` + `codex_policy_check` |
| [codex-edit-fusion](https://github.com/shine-233/codex-edit-fusion) | V4A 模糊补丁 + 四级降级匹配 | `codex_apply_patch` |
| [codex-session-kit](https://github.com/shine-233/codex-session-kit) | codex 会话导入/回放 + 持久记忆 | `codex_session_import`, `codex_memory` |
| [codex-net-guard](https://github.com/shine-233/codex-net-guard) | 纯 JS 网络白名单代理 | `codex_net_guard` |
| [codex-sandbox-bin](https://github.com/shine-233/codex-sandbox-bin) | 官方沙箱二进制 vendored 分发 | `codex_sandbox_status` |
| [codex-skills-kit](https://github.com/shine-233/codex-skills-kit) | 技能目录上下文预算渲染 | `codex_skill_catalog` |
| [codex-prompts](https://github.com/shine-233/codex-prompts) | 官方实战提示词资产 | `codex_prompts` |
| [codex-config-importer](https://github.com/shine-233/codex-config-importer) | config.toml → cordis.patch.yml 迁移 | `codex_config_import` |
| [codex-schema](https://github.com/shine-233/codex-schema) | 678 个线协议 TS 类型 | `codex_schema_info` |
| [dsh-codex-ledger](https://github.com/shine-233/dsh-codex-ledger) | 移植总控台账（142 单元全覆盖） | `codex_ledger_status` |
| [dsh-codex-ui](https://github.com/shine-233/dsh-codex-ui) | 吸收能力仪表盘 | `codex_ui_url` |
| **dsh-codex-pack**（本仓库） | 套件索引与装配清单 | `codex_kit_status` |

## 快速开始（装一整套）

每个插件也可单独安装；全装的最短路径：

1. Clone 本套件各仓库到同一父目录（如 `~/projects/dsh-codex/`）
2. 在你的 dsh profile `package.json`：

```jsonc
{
  "dependencies": {
    "codex-policy-engine": "link:../dsh-codex/codex-policy-engine",
    "codex-edit-fusion":   "link:../dsh-codex/codex-edit-fusion",
    // …其余同理
  },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
    "codex-policy-engine", "codex-edit-fusion" /* … */
  ] } }
}
```

3. `pnpm install && dsh --profile <name>` —— 完成。模型即刻多出上表全部工具。

推荐先只启用 policy-engine（audit 模式）观察一天，再切 `enforce`。

## 验证状态

- 各模块单测全绿（合计 32+ 用例）
- 已在官方 `@deepseek-ai/dsh@0.1.1-rc.2` 上完成：bundle 组合、真机启动、官方 Cordis 内核 + ToolRuntime 上逐工具实测
- 审批拦截缝在 enforce 模式下验证：`rm -rf /` → deny，未匹配命令 → ask

## 架构

```
openai/codex (Rust)                    dsh (Cordis 插件)
─────────────────                      ─────────────────
execpolicy        ──port──▶  codex-policy-engine ─▶ tools/pre-execute 缝
apply-patch/V4A   ──port──▶  codex-edit-fusion   ─▶ 工具注册
rollout 格式      ──port──▶  codex-session-kit   ─▶ 工具注册
network policy    ──port──▶  codex-net-guard     ─▶ 工具注册
sandbox bins      ──vendor─▶ codex-sandbox-bin   ─▶ 工具注册
skills/render.rs  ──port──▶  codex-skills-kit    ─▶ 工具注册
prompt assets     ──vendor─▶ codex-prompts       ─▶ 工具注册
schema (678 类型) ──port──▶  codex-schema        ─▶ 编译期契约
                            dsh-codex-ledger    ─▶ 总控台账（完整性不变量）
                            dsh-codex-ui        ─▶ 仪表盘
```

## 来源与许可

上游 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`（Apache-2.0）。各模块许可见各自 NOTICE.md。本仓库 Apache-2.0。
