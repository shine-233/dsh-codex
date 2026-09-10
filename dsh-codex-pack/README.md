# dsh-codex-pack

> 将 8 个 Codex→DSH 插件装配成一个 Cordis bundle layer；装配成功不等于运行时等效。

本包锚定历史来源 `openai/codex@970b7f2ff4f6`，增量审计另行记录，不把审计终点伪装成新的全量来源锚点。逐条证据审查当前为 0 条 `runtime-equivalent`；详见 [`../dsh-codex-ledger/EVIDENCE_AUDIT_20260910.md`](../dsh-codex-ledger/EVIDENCE_AUDIT_20260910.md)。

## 默认聚合

| 插件 | DSH 工具/挂载面 |
|---|---|
| `codex-policy-engine` | `codex_policy_check`, `codex_command_safety_check`, `tools/pre-execute` |
| `codex-edit-fusion` | `codex_apply_patch` |
| `codex-config-importer` | `codex_config_import` |
| `codex-prompts` | `codex_prompts` |
| `codex-session-kit` | `codex_session_import`, `codex_memory` |
| `codex-net-guard` | `codex_net_guard` |
| `codex-schema` | `codex_schema_info` |
| `codex-skills-kit` | `codex_skill_catalog`, `codex_skill_select` |

`codex-sandbox-bin` 是独立可选插件，不进入默认聚合：它的 status 工具可用，但原生资产重建链仍冻结。

## Profile 安装语义

`buildInstallPlan(root)` 先验证 manifest、实际包名、built export、各包 `dsh.bundle.patch` 和聚合 patch 的顺序一致性。`writeProfile()` 只做两件事：

1. 在 profile `dependencies` 中加入 `dsh-codex-pack` 和 8 个组件的本地 link；
2. 在 `dsh.profile.bundles` 中只加入 `dsh-codex-pack`。

聚合 patch 来自本包的 `dsh.bundle.patch`。Profile 自己的 `cordis.patch.yml` 是后置用户层，安装器保持其逐字节不变。写入 `package.json` 使用同目录临时文件、稳定 `.bak` 备份与故障回滚；dry-run 无写入，重复 apply 幂等。

示例 profile 结果：

```jsonc
{
  "dependencies": {
    "dsh-codex-pack": "link:../../dsh-codex-pack",
    "codex-policy-engine": "link:../../codex-policy-engine"
    // 其余 7 个组件同理
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "dsh-codex-pack"]
    }
  }
}
```

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm check:pack
pnpm pack:dry
```

集成测试使用真实 `@deepseek-ai/cordis@4.0.1` 与 `@deepseek-ai/cordis-plugin-loader@1.0.2`，通过测试注入的 sibling bundle importer 激活 8 个已提交 `lib/index.js`，断言 11 个工具注册并执行只读 `codex_policy_check`。这是 source-tree built-artifact/Cordis activation 证据；它绕过 bare-package resolution，不证明 clean registry install、offline multi-tarball 或 offline single-tarball dependency closure，也不是完整 DSH Profile Loader、ToolRuntime、Session、FS authority、prompt assembly、settings/provider、模型、网络或原生沙箱测试。

## 能力边界

本包不提供当前 DSH 尚无真实消费面的 MCP elicitation/user-verification proof、auth/account epoch、remembered approval、Guardian retained authorization/assessment、exec-server identity producer、Linux sandbox 重建或 daemon/PID/updater 架构。详见 [`docs/MOUNT_POINTS.md`](docs/MOUNT_POINTS.md) 与 [`docs/DSH-RUNTIME-CAPABILITY-AUDIT.md`](docs/DSH-RUNTIME-CAPABILITY-AUDIT.md)。

## 来源与许可

上游 [openai/codex](https://github.com/openai/codex)（Apache-2.0）。各模块许可与 provenance 见各自 `NOTICE.md`；本包为 Apache-2.0。
