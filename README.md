# codex-prompts

> OpenAI 大规模实战打磨的行为工程文案，复制即用。

## 吸收来源
- prompts (1,564)
- collaboration-mode-templates
- hooks/skills 内嵌模板文本抽取
- guardian-v2 classifier_instructions.md (91 行) + 分层审查模式文档

## 功能边界
**做**：审批策略话术、压缩续跑话术、评审模板、安全审查提示词；组装函数喂 dsh system-prompt 缝。

**不做**：不含代码逻辑；文案需按目标模型微调。

## API 草图
```
buildSystemPrompt(opts): string
```

## 验收标准
组装输出与 codex 实际 system prompt 逐字对齐。

## 上游同步
基于 openai/codex@970b7f2ff4f6（Apache-2.0）。季度 diff 由 dsh-codex-ledger CI 触发，见 ledger/coverage.yaml 对应行。

## M3 状态（资产已落地）
- ✅ 已从上游 prompts crate 抽取 16 个模板：
  - `templates/compact/prompt.md`
  - `templates/compact/summary_prefix.md`
  - `templates/goals/budget_limit.md`
  - `templates/goals/continuation.md`
  - `templates/goals/objective_updated.md`
  - `templates/permissions/approval_policy/never.md`
  - `templates/permissions/approval_policy/on_request.md`
  - `templates/permissions/approval_policy/on_request_rule_request_permission.md`
  - `templates/permissions/approval_policy/unless_trusted.md`
  - `templates/permissions/sandbox_mode/danger_full_access.md`
  - `templates/permissions/sandbox_mode/read_only.md`
  - `templates/permissions/sandbox_mode/workspace_write.md`
  - `templates/realtime/backend_prompt.md`
  - `templates/realtime/realtime_end.md`
  - `templates/realtime/realtime_start.md`
  - `templates/review/rubric.md`

- API：listTemplates / loadTemplate / buildSystemPrompt（支持 {{var}} 替换）
