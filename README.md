# dsh-codex-pack

> 收口集成层：判②③⑤⑥⑨的全部落点。

## 吸收来源
- plugin/core-plugins manifest 规范参考
- 融合件接线：hooks 11 事件集+合并器、子代理 wait/send/interrupt/fork 原语+图存储+跨产品委派双保留、todo Plan 互斥、MCP OAuth、denial 缓存

## 功能边界
**做**：权限预设接 policy-engine；编辑工具接 edit-fusion；配置迁移接 importer；system-prompt 接 prompts；/import 接 session-kit；沙箱策略接 net-guard+sandbox-bin；自动选技接 skills-kit。

**不做**：不含业务功能，只做接线。

## API 草图
```
install(ctx): void  # 注册全部插件
```

## 验收标准
dsh Web UI 内可见全部新能力端到端跑通。

## 上游同步
基于 openai/codex@970b7f2ff4f6（Apache-2.0）。季度 diff 由 dsh-codex-ledger CI 触发，见 ledger/coverage.yaml 对应行。
