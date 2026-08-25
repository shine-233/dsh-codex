# codex-policy-engine

> Declarative command approval engine for DeepSeek Harness — ported from openai/codex execpolicy.
> 把 openai/codex 的命令审批引擎移植进 dsh：让每一条 shell 命令在执行前经过可声明的 Allow / Prompt / Forbidden 裁决。

[![ci](https://github.com/shine-233/codex-policy-engine/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

一个**纯 JS 的命令审批引擎**：你用前缀规则声明"哪些命令直接放行、哪些必须询问用户、哪些一律禁止"，它在 agent 每次 shell 执行前做最安全优先聚合裁决。

- 规则模型移植自 `openai/codex` 的 `execpolicy/src/rule.rs + policy.rs`（锚点 `970b7f2ff4f6`）
- 零运行时依赖，Node 18+ 可用，8/8 单测覆盖
- 既可作为 **dsh 插件**接管 `tools/pre-execute` 审批缝，也可作为独立库嵌入任何 agent

## 为什么

dsh 原生审批只有"放行/询问"两态，规则藏在会话里不可复用。codex 在生产环境打磨出的 **Starlark execpolicy + 前缀规则树**解决了这个问题：策略即代码、可版本化、误杀率低。

## 快速开始

### 作为 dsh 插件（推荐）

```bash
# 1. 在 profile 的 package.json 里加依赖
"dsh": { "profile": { "bundles": ["codex-policy-engine"] } }
# dependencies 里加 "codex-policy-engine": "link:<本仓库路径>" 或 npm 发布后的包名

# 2. pnpm install 后重启 dsh 即生效
```

在 profile 的 `cordis.patch.yml` 中配置规则：

```yaml
- id: codex-policy-engine
  config:
    mode: enforce          # off | audit | enforce
    commandTools: ["bash", "pwsh", "*-bash*"]
    rules:
      - first: git
        rest: []                # git 任意子命令 → 放行
        decision: Allow
      - first: npm
        rest: [[run, exec], [test, build]]   # npm run/exec + test/build → 放行
        decision: Allow
      - first: rm
        rest: ["-rf", "/"]
        decision: Forbidden     # rm -rf / → 直接拒绝
```

三种模式：`off` 只注册检查工具不拦截；`audit` 记录未匹配命令但放行；`enforce` 未匹配一律弹给用户确认。

### 作为独立库

```js
import { Policy, prefixRule } from 'codex-policy-engine'

const policy = new Policy()
policy.addPrefixRule(prefixRule('git', ['status'], 'Allow'))
policy.check(['git', 'status'])       // → { decision: 'Allow', matchedPrograms: ['git'] }
policy.check(['rm', '-rf', '/'])      // → { decision: 'Prompt', ... }
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_policy_check` | `command` | 对任意命令行做只读裁决预览，返回 JSON 决策 |

## API 一览

| 导出 | 说明 |
|---|---|
| `Policy` | 规则容器：`addPrefixRule` / `check` / `mergeOverlay` / 网络域白名单 |
| `prefixRule(first, rest, decision)` | 构造前缀规则 |
| `altsToken(values)` / `singleToken(value)` | rest 位置的模式 token |
| `parsePolicyFile(text)` | 解析 Starlark 策略文件子集 |
| `apply(ctx, config)` | dsh 插件入口（name / inject / apply 三件套） |

## 来源与许可

移植自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`，上游 Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。本仓库同以 Apache-2.0 发布。

---

本仓库是 **codex→dsh 移植套件**的审批模块；总览与其他 11 个模块见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
