# codex-skills-kit

> Skill catalog budget rendering + lexical selection for DeepSeek Harness — design ported from openai/codex ext/skills.
> 把 openai/codex 的技能目录预算算法移植进 dsh：技能再多，也不撑爆上下文窗口。

[![ci](https://github.com/shine-233/codex-skills-kit/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

回答一个具体问题：**把 N 个技能的目录塞进系统提示词时，预算怎么算、超了砍谁？**

- 预算公式（1:1 移植上游 `render.rs`）：`min(10000, contextWindow × 2%)`，无窗口信息时兜底 8000 字符
- 单条描述超长自动截断到 1024 字符（带省略号）
- 超预算的条目按名字序静默降级，并报告 `included / omitted` 统计
- 5/5 单测覆盖；零运行时依赖

## 为什么

技能装得越多，"我能干什么"的自我介绍越贵。不设预算的 agent 要么烧 token 要么丢技能。codex 用一条朴素公式 + 确定性截断把这个工程问题变成了非问题——直接搬过来。

## 快速开始

### 作为 dsh 插件（推荐）

profile bundles 加入 `"codex-skills-kit"`。两种喂法：

```text
① 直接给条目
→ codex_skill_catalog({
    entries: [{ name: "commit", description: "git commit helper" }, …],
    contextWindowTokens: 128000
  })
← { "budgetChars": 2560, "included": 12, "omitted": 38, "catalog": "- commit: …" }

② 给目录（每个子文件夹含 SKILL.md，自动提取 frontmatter 的 name/description）
→ codex_skill_catalog({ dir: "~/.dsh/skills", contextWindowTokens: 200000 })
```

产出的 `catalog` 文本可直接拼进系统提示词。

### 作为独立库

```js
import { catalogBudgetTokens, renderCatalog } from 'codex-skills-kit'

const budget = catalogBudgetTokens(200000)          // → 4000
const { text, included, omitted } = renderCatalog(entries, budget)
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_skill_catalog` | `entries?/dir?`, `contextWindowTokens?`, `budgetChars?` | 按预算渲染技能目录 |

## API 一览

| 导出 | 说明 |
|---|---|
| `catalogBudgetTokens(window?)` | 上游同款预算公式 |
| `renderCatalog(entries, budgetChars)` | 确定性渲染 + included/omitted 统计 |
| `truncateDescription(s, max?)` | 1024 字符截断 |
| `apply(ctx, config)` | 插件入口；`config.catalogDir` 可作默认目录 |

## 来源与许可

设计移植自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`（`ext/skills/render.rs`），上游 Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的技能模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
