# codex-skills-kit

> 判④扩容：codex 技能系统全面领先部分的完整移植。

## 吸收来源
- ext/skills 的 render.rs (1,103 token 预算渲染)
- dynamic_skill_selector (~1,600, 9 种确定性词法选择器/影子实验)
- 六层发现 scope 设计(host_roots) + aliases/invocation 概念

## 功能边界
**做**：目录按上下文窗口 2%（≤10k tok）动态预算渲染；BM25/n-gram/RRF 自动选技；$mention 结构化选择。

**不做**：不做技能内容本身；Executor/Orchestrator provider 不搬。

## API 草图
```
renderCatalog(skills, budget): PromptFragment
selectSkills(query, catalog): Skill[]
```

## 验收标准
BM25 选技召回率对齐上游快照；目录 token 占用 ≤ 上下文 2%。

## 上游同步
基于 openai/codex@970b7f2ff4f6（Apache-2.0）。季度 diff 由 dsh-codex-ledger CI 触发，见 ledger/coverage.yaml 对应行。
