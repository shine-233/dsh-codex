# codex-session-kit

> Session rollout import, trace replay and memory kit for DeepSeek Harness — ported from openai/codex session formats.
> 把 openai/codex 的会话格式资产移植进 dsh：导入历史 rollout、容错解析、跨产品记忆持久化。

[![ci](https://github.com/shine-233/codex-session-kit/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

三件事，一个包：

1. **会话导入**：扫描 `~/.codex/sessions/*.jsonl`，逐行容错解析（坏行计数而不崩溃），在返回 header 前清除 Git remote authority 中的用户名/密码/token，并归一化成 dsh 事件形状
2. **回放就绪**：`header + items + badLines` 三段结构，可直接驱动轨迹回放或统计
3. **记忆存储**：`MemoryStore` 追加式 JSONL 日志 + 启动重建，进程重启记忆不丢

本地验证使用 Vitest 4.1.11；不把 Git URL 脱敏宣称为网络或文件系统安全边界。

## 为什么

换 harness 最怕历史资产作废。codex 用户积累的会话与记忆应该能**一键带进 dsh**，而不是留在旧格式里吃灰。

## 快速开始

### 作为 dsh 插件（推荐）

profile bundles 加入 `"codex-session-kit"` 重启后，模型获得两个新工具：

```text
用户：把我 ~/.codex/sessions 里最近一次会话导进来看看
模型调用 → codex_session_import({ dir: "~/.codex/sessions" })   // 列出全部
        → codex_session_import({ path: "<某个 rollout>" })      // 解析详情+事件流

用户：记住这个项目用 pnpm 不用 npm
模型调用 → codex_memory({ action: "set", key: "pkg-manager", value: "pnpm" })
```

### 作为独立库

```js
import { listSessions, parseRolloutFile, toDshEvents, MemoryStore } from 'codex-session-kit'

for (const s of listSessions('~/.codex/sessions')) console.log(s.file, s.sizeBytes)
const { header, items, badLines } = parseRolloutFile(s.file)
const events = toDshEvents(items)          // → [{ type, payload }, ...]

const mem = new MemoryStore('./memory.jsonl')
mem.set('route', 'codex-port')             // 重启后自动重建状态
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_session_import` | `dir?` / `path?`, `maxItems?` | 列出/解析 codex 会话 rollout |
| `codex_memory` | `action: get/set/delete/list`, `key?`, `value?` | 持久键值记忆（默认存 `~/.dsh/codex-memory.jsonl`） |

## API 一览

| 导出 | 说明 |
|---|---|
| `listSessions(dir)` | 容错列出 rollout 文件（按大小排序） |
| `parseRolloutFile / parseRolloutText` | 逐行容错解析；暴露 header 前脱敏 `payload.git(.git_info).repository_url` |
| `sanitizeGitRemoteUrl(value)` | 清除 URL/SCP/helper remote 的 authority 凭据，保留路径编码；非法输入 fail closed |
| `sanitizeOptionalGitRemoteUrl(value)` | 读取历史持久 metadata 时的容错版本；非法 remote 返回 absent |
| `toDshEvents(items)` | 归一化为 `{type, payload}` 事件流 |
| `MemoryStore` | 追加式 JSONL 记忆库（set/get/delete/keys） |
| `SessionIndex` | node:sqlite 可用时的镜像索引 |
| `formatSubagentRoster(entries)` | 有界子代理名册格式化（≤8 行、≤1024 UTF-8 字节、诊断条目 fail closed） |
| `MAX_ROSTER_ROWS` / `MAX_ROSTER_BYTES` | 名册行数上限（8）与字节上限（1024） |
| `apply(ctx, config)` | dsh 插件入口；`config.memoryPath` 自定义存储路径 |

## 请求时子代理名册（行为子集）

当 `codex-session-kit` 作为 dsh 插件加载、且运行时同时提供 `agents`、`systemPrompt`、`subagents` 服务时，插件会为每个 Agent 挂载一个 `system-prompt/assemble` 异步消费者。每次模型请求前：

- 调用 `ctx.subagents.listChildren(parentSessionId, signal)` 读取该会话的直接子代理；无子代理时不产生任何上下文贡献
- 把结果渲染为 `<subagents>` XML 快照：durable `id`、`mode`（`one-shot` / `continuable`）、可选 `label`；顺序按创建时间再按 Session ID 稳定排序；属性做 XML 转义
- 有界：最多 `MAX_ROSTER_ROWS` = 8 行、整个信封最多 `MAX_ROSTER_BYTES` = 1024 UTF-8 字节；放不下的行跳过并继续；全部放不下则整体不贡献
- 列表中若出现 `diagnostic` 条目（`corrupt` / `unsupported` / `unavailable`）则在任何截断之前 fail closed（抛出错误，不静默降级）
- 通过已有的运行时上下文 `user/message` 快照机制持久化，不引入名册专属 Session 事件；因此整机重启后下一次请求可从会话日志重建

名册依赖 `subagents` 服务的存在；缺失该服务时插件其余工具照常注册，名册静默不启用。本能力仅覆盖上述窄子集，不宣称与 codex 子代理协议完全等价。

**已验证边界**：`listChildren` 从 `subagent` identity projection 归类每个候选；若 one-shot 子代理在父会话本轮内**仍处于 live**（其 descriptor 序列尚未被自身 live session 拥有），会被视为仍在其 creation window 内而跳过——与 DSH 对「尚无 identity 的 live 子代理」的规则一致。该子代理在转为 cold（会话在 corpus 中物化）后即可被解析。因此同一轮内刚结束的 one-shot 可能不在名册中，而重启/冷读后会出现。这是 DSH 的消费边界，不是名册缺陷。

## 来源与许可

移植自 [openai/codex](https://github.com/openai/codex) 历史锚点 `970b7f2ff4f6` 的会话格式；Git remote 脱敏契约另对照本地上游 `121f91fd5` 的 `codex-rs/protocol/src/sanitized_git_url.rs` 与完整测试语义。上游 Apache-2.0，详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的会话模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
