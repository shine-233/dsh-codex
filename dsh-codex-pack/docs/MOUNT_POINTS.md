# dsh 挂载点对照表（判②③⑤⑥⑨落点）

| 能力 | dsh 挂载缝 | 本仓接线 | 来源判决 |
|---|---|---|---|
| 命令审批 | tool-bash.approvalEngine / ctx.approval | R2 policy-engine | 判② |
| 输出截断 | tool-bash 渲染层 | R2 output-truncation 移植件 | 判② |
| Hooks 事件集 | hooks 包事件注册 | R10 适配 11 事件→dsh 钩点 | 判③ |
| 子代理原语 | subagent 包 | wait/send/interrupt/fork + graph store | 判⑤ |
| Plan 互斥 | plan-mode | plan 激活时锁 todo 写 | 判⑥ |
| SSE 保真 | llm 层事件映射 | R1 事件类型消费 | 判⑨ |
| MCP OAuth | mcp-client | rmcp-client 设计移植 | 判⑨ |
