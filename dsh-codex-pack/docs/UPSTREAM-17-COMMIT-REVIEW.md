# Upstream Codex 17-Commit Review

审计对象：`openai/codex` `121f91f..f3f53ee`（2026-09-07）。结论只针对 dsh 移植边界，不代表 dsh 已实现这些能力。

| 上游变化 | dsh 决策 | 理由 |
|---|---|---|
| MCP user-verification transport / auth changes | 运行时阻断，暂不迁移 | 已核验 DSH 主 MCP client：仅桥接 tools，client 明确广告 `{ capabilities: {} }`，没有 elicitation/user-verification handler、proof provider、auth/account epoch 或 auth-change 生命周期。能力必须保持不广告，不能在迁移包伪造 gate |
| MCP elicitation 复用共享 approval path | 设计采纳，运行时阻断 | `user-questions`/`user-approval` 可作交互基础，但现有 approval 只能返回一次性 allow/reject 等结果，不能承载结构化表单或 proof；缺少按 MCP connection generation 持有的单 owner provider 与完整 cancellation |
| extension decision API 审批统一 | 最小适配层已落地 | `codex-policy-engine` 新增调用级 `decisionAdapter`（callId/rootCallId/signal，delegate/ask/deny，异常 fail closed）和独立 `runtimeObserver`；DSH 无通用 approval outcome feedback，故不实现 remembered grant |
| extension API runtime/type expansion | 不机械迁移 | 计划中的 `codex-schema/src/handwritten/extension-api/types.ts` 在当前 checkout/历史中不存在；本地仅有四字段 `ExtensionToolSpec` validator，而上游 Rust contributor/executor traits 是进程内运行时 API，不能冒充 JSON wire schema。除非出现真实消费方，否则不新建虚构全量类型层 |
| stale approval / Guardian evidence consistency | 已落地（无 OpenAI 绑定） | `codex-policy-engine` 新增 `issueApprovalEvidence` / `validateApprovalEvidence`：资源指纹+决策绑定、时间窗口、撤销和稳定失效原因；不包含 Guardian 客户端 |
| shell snapshot diagnostic labels | 低优先级蒸馏 | 可映射到现有 diagnostics report，但不影响命令决策正确性 |
| Guardian async sampler connection pool | 暂不迁移 | 强依赖 OpenAI Guardian scorer / 网络运行时，超出当前 prompt-only 边界 |
| model/TUI/resume/fork/V8 release changes | 排除 | UI、Rust 胶水、V8 发布基础设施或 dsh 已有等价层 |

准入结论：extension decision 已按 DSH 现有 pre-execute/result 能力收口，但审批 outcome feedback 被运行时契约明确阻断。主 MCP client 的 tools-only 实现也已核实，因此当前不新增 user-verification/elicitation 代码；未来只有在 DSH 同时提供显式 trusted-host opt-in、精确模式能力、连接代际单 owner provider、proof 保密、请求关联、断连/替换/abort cancellation，以及单调 auth/account epoch 后才能重新打开。unsupported/disabled 必须 fail closed，不能复制 OpenAI 服务客户端或把生成协议类型当作运行时支持证据。
