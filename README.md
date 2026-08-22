# codex-prompts

> Battle-tested prompt assets from openai/codex, packaged for DeepSeek Harness.
> openai/codex 实战提示词资产的 vendored 分发：压缩、评审、目标预算——官方调过的提示词，别再自己瞎写。

[![ci](https://github.com/shine-233/codex-prompts/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

把 codex 仓库里经过生产验证的提示词模板（`assets/templates/**.md`）原样 vendor，并包成可编程接口：

- `listTemplates()` —— 枚举全部模板相对路径
- `loadTemplate(path)` —— 取单篇原文
- `buildSystemPrompt(paths, vars)` —— 多篇拼接 + `{{变量}}` 替换

作为 dsh 插件时，模型可通过 `codex_prompts` 工具自助检索与组装。

## 为什么

提示词是 codex 里迭代成本最高的资产（真实用户反馈喂出来的）。自己重写一遍既费时又更差；正确姿势是 **vendor + 引用**，上游季度 diff 时跟着更新。

## 快速开始

### 作为 dsh 插件（推荐）

profile bundles 加入 `"codex-prompts"`，对话里：

```text
→ codex_prompts({ action: "list" })
← ["templates/compact/prompt.md", "templates/goals/budget.md", …]

→ codex_prompts({ action: "build",
                   paths: ["templates/compact/prompt.md"],
                   vars: { project: "my-app" } })
← "# Compaction guidance\n\nYou are working on {{project}}…"   // 变量已替换
```

### 作为独立库

```js
import { listTemplates, buildSystemPrompt } from 'codex-prompts'

const sys = buildSystemPrompt(
  ['templates/compact/prompt.md', 'templates/goals/budget.md'],
  { project: 'my-app' },
)
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_prompts` | `action: list/get/build`, `path?/paths?`, `vars?` | 模板检索与系统提示词组装 |

## API 一览

| 导出 | 说明 |
|---|---|
| `listTemplates()` | 全部模板路径（排序） |
| `loadTemplate(relPath)` | 单篇原文 |
| `buildSystemPrompt(paths, vars?)` | 拼接 + `{{key}}` 替换（未提供的占位符原样保留） |
| `apply(ctx, config)` | 插件入口 |

## 来源与许可

模板来自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`，Apache-2.0。未修改文案，详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的提示词模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
