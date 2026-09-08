# DSH Runtime Capability Audit

审计时间：2026-09-08（Asia/Shanghai）  
审计范围：本地 `active/deepseek-harness-study` 的 DSH 运行时源码；迁移目标为
`active/dsh-codex-monorepo`。本报告只记录已读到的真实接口，不把上游 Codex
wire schema 当作 DSH runtime 能力。

## 结论摘要

| 能力 | DSH 现状 | 对 Codex→DSH 迁移的结论 |
|---|---|---|
| extension decision（调用前决策） | DSH 有 `tools/pre-execute`/工具 waterfall 可供插件接入；本地 `codex-policy-engine` 已做最小 `decisionAdapter` | 可做调用级 delegate/ask/deny 适配；不能据此声称已有通用审批 outcome feedback 或 remembered grant |
| MCP tools | `dsh-mcp-client` 连接、发现、注册工具、list-changed 重同步、断线重连均有真实实现 | 已有运行时基础，可迁移 tools-only bridge |
| MCP elicitation | Codex wire 有 `mcpServer/elicitation/request`，但 DSH MCP client 初始化广告空 capabilities，未注册 elicitation handler | 当前必须保持不广告；不能把 `ctx.userQuestions` 直接冒充 MCP elicitation transport |
| MCP user-verification | DSH 有通用 `ctx.userQuestions` 和 `ctx.approval`，但没有 MCP connection-owned proof/verifier/auth identity seam | 当前无可迁移的 MCP user-verification gate；unsupported 时 fail closed |
| auth-change notification | MCP client/connection 代码没有 auth-change/auth epoch/account identity handler | 未实现；不能伪造 OAuth/auth state 变化通知 |

## 1. MCP client：真实能力是 tools-only

证据：

- `deepseek-harness-study/packages/mcp/mcp-client/src/connection.ts:238-241`
  每个连接创建 SDK `Client` 时传入 `{ capabilities: {} }`。
- `connection.ts:257-268` 只注册
  `ToolListChangedNotificationSchema`，收到 `notifications/tools/list_changed`
  后重新调用 `syncTools`。
- `connection.ts:272-302` 连接失败/断开后走有界指数退避、代际关闭等待和重连；
  这不是 auth 生命周期。
- `mcp-client/README.md` 的 Services consumed 表只列 `ctx.tools`；行为章节只描述
  `tools/list_changed`、`tools/call`、断线重连和工具注册。
- 仓库范围搜索 `packages/mcp/mcp-client` 没有 `elicitation`、`user-verification`、
  `auth-change`、`auth epoch`、账户身份或 proof provider 的实现。

因此，DSH 的 MCP 运行时当前是“连接外部 MCP server、同步 tools 到 `ctx.tools`、
调用工具”的 bridge，不是完整 MCP client capability host。`codex-schema` 中生成的
`McpElicitation*` 类型只能证明 wire schema 存在，不能证明 bridge 已实现该请求。

## 2. DSH 通用审批服务：可用但语义更窄

证据：

- `packages/interaction/user-approval/src/index.ts:241-257` 定义
  `ctx.approval.request(req)`，要求请求属于 open turn，并写入
  `approval/asked`/`approval/decided` 配对审计事件。
- `src/types.ts:30-34` 的闭合结果只有
  `allowed-once | rejected | cancelled | unavailable`。
- `src/index.ts:305-338` 对 abort、`never` policy、waterfall answerer 异常均有
  fail-closed 行为；没有 `allow-always`、grant store、撤销或可复用 approval token。
- `packages/interaction/user-approval/README.md:60-62` 明确写出只有一次性授权、
  没有内置 answerer；缺失 answerer 时返回 unavailable 并关闭。

这足以支持迁移插件的调用级“询问/拒绝/委托”适配，但不足以支持 Codex 上游中
可复用审批记忆、审批反馈事件、资源指纹 grant 或跨连接授权。`approval/decided`
是 session log audit event，不是一个通用的 runtime `approval/result` 事件总线。

## 3. DSH user-questions：通用 UI 交互，不等于 MCP elicitation

证据：

- `packages/interaction/user-questions/src/index.ts:37-40` 的 provider 只有
  `ask(request): Promise<AskUserQuestionAnswer>`；服务通过
  `ctx.userQuestions.ask()` 暂停并等待 UI provider。
- `src/index.ts:64-73` 规定一个 context 只能有一个 active provider；
  `src/index.ts:92-139` 检查 abort、空问题、live agent、delegated caller、
  intent 合法性和 provider 存在性。
- `src/types.ts:17-57` 支持选项、多选、自由文本和 `plan-review` presentation intent，
  但 intent 只改变展示，不是 MCP connection capability 或 cryptographic proof。

该服务可以成为未来 elicitation adapter 的 UI 后端候选，但目前缺少：

1. 按 MCP connection generation 绑定的单一 owner；
2. MCP request id 与 answer 的强关联；
3. proof/verification 结果的保密与来源证明；
4. 断连、替换、abort 的完整请求取消语义；
5. 单调 auth/account epoch 及账户身份。

所以不能仅因 `ctx.userQuestions` 存在，就在迁移包中宣称支持 MCP elicitation 或
user-verification。

## 4. Codex wire 对比：elicitation 端点确实存在，但 DSH 未承接

上游适配代码证据：

- `packages/subagent/subagent-codex/src/wire.ts:307-310` 显式处理
  `mcpServer/elicitation/request`，无人值守实现返回
  `{ action: 'decline', content: null, _meta: null }`。
- 同一处理器还分别处理 command/file approval、permissions approval 和
  `item/tool/requestUserInput`；这些是 Codex app-server wire 请求，不是
  `dsh-mcp-client` 的 MCP server request handler。

这说明当前 DSH 对 Codex subagent 的安全选择是“收到 elicitation 时明确拒绝”，
而不是伪造用户回答。迁移时应保留该 fail-closed 语义，直到 MCP bridge 暴露明确
capability 与 provider seam。

## 5. 缺口与建议路线

### 现在可做

- 保持现有 `decisionAdapter` 的调用级三态映射（delegate/ask/deny），身份缺失、
  abort、异常和异步拒绝全部 fail closed。
- 继续使用 `runtimeObserver` 观察工具最终结果，但把它命名为 result observer，
  不把结果误标为审批 outcome。
- 在文档和 capability 清单中明确 MCP bridge 为 tools-only，并对 elicitation、
  user-verification、auth-change 标记 unsupported。

### 只有 DSH runtime 增加以下契约后才重启迁移

1. trusted-host opt-in 与精确 capability advertisement（至少包含 elicitation 和
   verification 的版本/模式）；
2. connection generation 单 owner provider，且 request/answer 有不可混淆的关联 id；
3. proof 保密、来源/受众绑定、过期与撤销语义；
4. 连接断开、替换和调用 abort 的全生命周期 cancellation；
5. 单调 auth/account epoch、auth-change notification 与账户身份边界；
6. 可观测但不可复用伪造的 approval outcome feedback seam。

在这些契约出现之前，任何把上游 schema、`ctx.userQuestions` 或一次性
`approval/decided` 日志拼成“已支持 MCP user-verification/elicitation/auth change”
的实现都会扩大能力声明，必须拒绝。

## 可复核命令

```powershell
rg -n "capabilities|setNotificationHandler|elicitation|auth.?change|auth.?epoch|user.?verif" `
  active/deepseek-harness-study/packages/mcp/mcp-client `
  active/deepseek-harness-study/packages/interaction
```

审计只读了本地源码和文档；没有读取用户 `~/.codex`，没有修改 DSH 源码，也没有
将该报告视为 runtime capability 的实现证明。
