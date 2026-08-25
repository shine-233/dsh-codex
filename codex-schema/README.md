# codex-schema

> Wire-protocol contracts ported from openai/codex: TypeScript types + zod-ready shapes.
> openai/codex 线协议的类型契约库：678 个生成类型 + 手写协议面，让 dsh 侧代码与 codex 协议对得上。

[![ci](https://github.com/shine-233/codex-schema/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

把 codex 的协议面翻译成 TypeScript 类型，供 dsh 侧（或任何 TS 项目）编译期对齐：

| 协议面 | 来源 | 形态 |
|---|---|---|
| `app-server-protocol/v2` | 上游 schema 生成 | **678 个类型**（Thread / Turn / McpServer / Plugin / Skills / Hooks…） |
| `protocol` / `exec-server-protocol` / `code-mode-protocol` / `history` | 手写移植 | 核心消息与事件形状 |

质量门：`tsc --noEmit` 全绿（CI 同款）。

## 为什么

dsh 与 codex 对接时最贵的错误是"字段名对上了、语义没对上"。与其在运行时猜，不如把上游类型搬过来，**编译期就锁死协议**。

## 快速开始

```ts
import type { Thread, TurnStatus } from 'codex-schema'          // v2 app-server 面
import * as protocol from 'codex-schema/…handwritten/protocol'  // 手写核心面

function renderThread(t: Thread) { /* t.status: ThreadStatus 已锁死 */ }
```

> 这是纯类型包（types-only），没有运行时代码——装它就是为了 `tsc`。

### 作为 dsh 插件

同样提供标准插件入口（name/inject/apply），注册一个 `codex_schema_info` 工具报告锚点版本与协议覆盖面，方便在宿主内确认当前对齐的上游版本。

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_schema_info` | — | 报告协议锚点、许可与覆盖面 |

## 来源与许可

类型生成自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6` 的协议定义，Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的契约模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
