# codex-edit-fusion

> Fuzzy V4A patch engine fused with atomic writes, for DeepSeek Harness — ported from openai/codex apply-patch.
> 把 openai/codex 的 V4A 模糊补丁引擎移植进 dsh：模型给的 patch 不必逐字符精确，四级降级匹配让编辑成功率大幅上升。

[![ci](https://github.com/shine-233/codex-edit-fusion/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

解析并应用 openai/codex 的 `*** Begin Patch`（V4A）格式补丁：

- **Add / Delete / Update / Rename** 全支持，含 `@@ change context`
- 匹配四级降级：**精确 → 去尾空白 → 首尾空白 → Unicode 标点归一**（移植自上游 `seek_sequence.rs`），弯引号、全角破折号、不间断空格统统不碍事
- 10/10 单测覆盖，零运行时依赖
- 作为 **dsh 插件**时提供 `codex_apply_patch` 工具，模型可直接调用

## 为什么

dsh 原生 str-replace 编辑要求精确匹配，模型输出常因一个空格/引号差异而失败重试。codex 的 seek_sequence 用渐进放宽的锚点查找解决了这个问题——这是它编辑可靠性的核心秘密之一。

## 快速开始

### 作为 dsh 插件（推荐）

profile 的 `package.json` bundles 加入 `"codex-edit-fusion"` 并声明依赖，重启即可。之后模型在对话里就能直接产出 V4A 补丁调用工具：

```text
模型调用 → codex_apply_patch({
  cwd: "C:/work/my-project",
  patch: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-const greeting = \"hello\"\n+const greeting = \"hello, dsh\"\n*** End Patch"
})
→ {"applied":[{"file":"src/app.ts","status":"applied"}],"errors":[]}
```

### 作为独立库

```js
import { parsePatch, applyPatch } from 'codex-edit-fusion'
import { readFileSync } from 'node:fs'

const patch = parsePatch(patchText)
const files = new Map([['app.ts', readFileSync('app.ts', 'utf8')]])
const { files: out, results, errors } = applyPatch(patch, files)
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_apply_patch` | `patch`, `cwd?` | 对工作目录应用 V4A 补丁，返回逐文件结果 |

## API 一览

| 导出 | 说明 |
|---|---|
| `parsePatch(text)` | 解析 V4A 文本为结构化 Patch |
| `applyPatch(patch, files, locate?)` | 应用到内存文件 Map；可注入自定义定位器 |
| `seekSequence(lines, pattern, start)` | 四级降级模糊定位（独立可用） |
| `apply(ctx, config)` | dsh 插件入口 |

## 来源与许可

移植自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`（`codex-rs/apply-patch`），上游 Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的编辑模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
