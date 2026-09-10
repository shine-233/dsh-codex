# DSH 挂载点对照表

`dsh-codex-pack` 是一个 bundle layer。Profile 只列出该包；其 `cordis.patch.yml` 按顺序挂载以下 8 个 Cordis 插件。Profile 自己的 `cordis.patch.yml` 是后置用户层，不由安装器改写。

下表只说明 source-tree built bundles 已观察到的注册面，不证明各上游能力已通过 DSH authority、persistence 或 request lifecycle 达到运行时等效；逐条等级见 [`../../dsh-codex-ledger/EVIDENCE_AUDIT_20260910.md`](../../dsh-codex-ledger/EVIDENCE_AUDIT_20260910.md)。

| 插件 | 已观察挂载面 | 注册工具 |
|---|---|---|
| `codex-policy-engine` | `tools` service；可选 `tools/pre-execute` / `tools/result` | `codex_policy_check`, `codex_command_safety_check` |
| `codex-edit-fusion` | `tools.register` | `codex_apply_patch` |
| `codex-config-importer` | `tools.register` | `codex_config_import` |
| `codex-prompts` | `tools.register` | `codex_prompts` |
| `codex-session-kit` | `tools.register` | `codex_session_import`, `codex_memory` |
| `codex-net-guard` | `tools.register` | `codex_net_guard` |
| `codex-schema` | `tools.register` | `codex_schema_info` |
| `codex-skills-kit` | `tools.register` | `codex_skill_catalog`, `codex_skill_select` |

`codex-sandbox-bin` 保持独立可选，只提供 `codex_sandbox_status`；当前默认 bundle 不把冻结的原生资产当作已重建能力。

## 明确不挂载

当前 DSH 没有足以支持以下能力的真实消费面，因此本包不模拟：MCP elicitation/user-verification proof、auth/account epoch、可复用 remembered approval、Guardian retained authorization/assessment、plan locking、SSE 保真层、exec-server identity producer、daemon/PID/release updater。出现 host-owned seam 与 keyless 行为测试前，这些项目保持阻断或排除。
