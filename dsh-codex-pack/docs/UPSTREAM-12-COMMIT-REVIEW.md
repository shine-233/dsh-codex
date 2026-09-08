# Upstream Codex 12-Commit Incremental Review

审计对象：`openai/codex` `f3f53ee949eeaa9b6050699a783b94fe4ee8ff0d..adee0b04fa27a8ba5d2e3612b900363cffe72930`（2026-09-08 刷新）。本表区分协议/纯算法、DSH runtime 阻断和 OpenAI/Guardian/发布基础设施，不把生成类型或文档当作运行时能力。

| 提交 | dsh 决策 | 证据与边界 |
|---|---|---|
| `adee0b04f` standalone release pins | 排除（E5 发布/daemon 基础设施） | 仅涉及 app-server-daemon updater、standalone installer、安装锁和 Unix 进程组取消；当前迁移包没有 daemon/updater runtime，不能映射成 profile writer |
| `b1205c12d` Rust recursion limit | 排除（Rust 构建基础设施） | 只给 app-server/exec/TUI crate 增加 `recursion_limit=256`，无 TypeScript/DSH 对应行为 |
| `dbe2f6d52` executor build identity | **协议字段已蒸馏；producer runtime 阻断** | `codex-schema` 的 `EnvironmentInfo` 已补 `executorVersion` 与可选 `providerId?: string`，validator 同时接受 legacy 缺字段和 opaque string、拒绝非字符串；schema 全包 35/35。SHA-256 producer、启动缓存、Cargo/Bazel stamp 仍属 exec-server runtime，不能宣称 DSH 能生成可信 build identity |
| `6750f5bd1` zombie PID handling | 排除（daemon 进程生命周期） | 依赖 Unix `ps` state + `waitpid(WNOHANG)`，应由 DSH 外部 supervisor 承担；本仓无 PID backend |
| `9f70e348e` selected-history internal fork | DSH runtime 阻断 | `codex-session-kit.forkPrefix()` 只能选择前缀；没有内部 session manager、parent auth/budget sharing、隐藏 registry 或 interruption-aware lifecycle，不能冒充 `fork_internal_session` |
| `d0a8dcd15` filtered archive scan | 当前排除（无消费方） | 本地 `ThreadStore` 无 archive/unarchive API 或 rollout-reference index；单独移植 filename scanner 是无消费者的基础设施 |
| `d665e3bbc` unloaded children in v2 context | **纯算法已蒸馏** | `AgentGraphStore` 已有持久 spawn graph，现增加持久 `agentPath` 与 v2 roster builder：冷恢复后取直接 children、loaded 优先、组内按 full path 排序、排除 grandchildren、8 agents / 1,024 bytes 上限。只提供 host 可注入的纯上下文算法，不宣称已接入 DSH world-state prompt |
| `d70044072` shared Guardian helpers | Guardian runtime 排除；parser 可选 | reviewer config、网络/权限/MCP 配置不迁移。其结构化 assessment JSON parser 可在 prompt 消费方采用统一 JSON contract 后单独蒸馏；当前 prompt-only `APPROVE/REJECT` 面不强行扩张 |
| `16ff14c26` inherited Guardian instructions | 集成阻断；仅保留设计不变量 | inherited/local ordering namespace、source scope 与 incomplete evidence 是合理不变量；本地没有 inherited transcript provenance 或 retained-authorization consumer，不能宣称 enforce |
| `aa12ab45d` retained context reconciliation | 高价值纯算法候选，当前集成阻断 | message-id、turn-id+text、acceptance-order reconciliation 可独立测试，但本地 rollout payload 仍为 `any`，没有 host-owned acceptance order/source completeness；在输入模型明确前不造 runtime 语义 |
| `db0568dbb` remove legacy Guardian paths | 已有架构方向等价，无删除项 | 本地 policy engine 只有单一可选 `decisionAdapter`，没有 fast/full legacy review path；保持一个 authoritative decision path |
| `8260619cb` centralized Guardian context policy | 仅采纳不变量 | session mode 一次解析、latest-only compatible checkpoint、strict fail-closed 是设计准则；encrypted compaction、model hash、Luna/Guardian review wiring 均排除 |

本批先落地 `d665e3bbc`，因为它有真实本地持久图 seam、无需 DSH 产品授权且可机器验证；代码复核后又补齐 parent/direct-child path invariant 与精确 UTF-8/escaping 字节边界。随后完成 `dbe2f6d52` 的兼容性 wire 小缺口，但严格只到 `EnvironmentInfo.providerId?: string` 类型/validator，不包含 producer、缓存或构建身份可信性。后续候选按顺序：retained-evidence reconciliation（先建明确输入类型）；Guardian assessment parser（仅当 prompt 改用同一 JSON contract）。严禁把这些纯类型/算法写成 daemon、exec-server、Guardian 或 remembered-approval runtime 已完成。
