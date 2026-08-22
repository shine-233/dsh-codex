# dsh-codex-ui

> 移植能力的可视化面板：记忆浏览器 / 网络护栏日志 / 审批事件流 / 会话导入向导。

## 面板规格（v0）
| 面板 | 数据源 | 状态 |
|---|---|---|
| Memory Browser | session-kit MemoryStore 的 memory.jsonl | ✅ 原型 |
| Net-Guard Log | net-guard 拦截日志粘贴/文件 | ✅ 原型 |
| Approval Stream | policy-engine 裁决事件 | 🚧 待接线 |
| Import Wizard | session-kit 导入器 | 🚧 待接线 |

## 运行原型
```
node server.mjs   # http://127.0.0.1:7777
```
打开后选择 memory.jsonl 或粘贴 net-guard 日志。
