# 迁移总计划（codex → dsh，经 dsh-codex-pack 插件化）

锚点：openai/codex@970b7f2ff4f6（Apache-2.0）｜生成日期：2026-08-22

## 三道防遗漏锁
1. **范围锁** coverage.yaml：141 个上游 manifest 逐条登记去向（本仓 CI 日检 upstream diff）
2. **广度锁** 表面对账：工具目录/协议方法/CLI 动词/prompts 四类表面三方核对
3. **行为锁** 差分运行：20 个标准任务双端实测（M6 终检签字）

## 里程碑
| 里程碑 | 内容 | 工期 | 验收 |
|---|---|---|---|
| M0 | ledger 上线（本仓） | 0.5天 | coverage.json UNMAPPED=0 |
| M1 | codex-schema | 2周 | 解析100个真实会话零报错 |
| M2 | policy-engine + edit-fusion（并行） | 2周 | 裁决一致率100%；模糊补丁率≥上游 |
| M3 | prompts + session-kit | 3周 | system prompt逐字对齐；会话导入成功 |
| M4 | sandbox-bin vendor+构建链 | 3周 | 三平台同一策略跑通 |
| M5 | net-guard + pack 收口 | 3周 | dsh UI 内端到端可见全部能力 |
| M6 | 20任务差分运行 | 1周 | 行为差异清单归档并签字 |

## 九组对决判决索引
①编辑=嫁接(R3) ②执行截断=R2 ③Hooks事件集=R10 ④技能=R9 ⑤子代理原语=R10
⑥Plan互斥=R10 ⑦SQLite镜像+fork=R6 ⑧配置缩水=R4 ⑨SSE保真=R1/MCP OAuth=R10

## 同步策略
季度运行 scripts/verify_coverage.py 对 upstream HEAD；新增 crate 进待分配队列；
每模块 README 记录各自 anchor commit。

## 风险登记
- 上游高频更新（日推 commits）：靠锁1自动发现
- Windows 沙箱维护成本：vendor 层独立成仓隔离影响面
- 提示词跨模型漂移：prompts 仓标注"按 GPT 行为调教"，接入时需评测
