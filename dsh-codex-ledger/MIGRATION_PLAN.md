# 迁移与发布就绪计划（codex → DSH）

历史锚点：`openai/codex@970b7f2ff4f6`（Apache-2.0）。该 SHA 是台账来源锚点，不随增量审计移动。

## 当前状态（2026-09-10 证据纠偏）

- 台账当前共 **153 个时序 row**：旧 150-row 集合的迁移标签为 **7 implemented / 46 distilled / 97 EXCLUDED**；补录 `adee0b0` 的 3 个遗漏 crate 后为 **7 implemented / 46 distilled / 100 EXCLUDED**。标签只表示代码去向，不是等效证明。
- 对 53 条正向记录的只读证据审查结果：**0 runtime-equivalent / 9 behavioral-subset / 6 structural-only / 37 implemented-unconsumed / 1 unsupported-overclaim**。
- 原 97 条排除记录的 78/1/18 只是已失效的首轮架构口径。精确源码复核现已覆盖全部 **100/100 current excluded rows**（含 3 个补录 crate）：**37 split / 13 blocked / 38 excluded / 12 migration-candidate**。这些是源码去向裁决，不代表候选能力已经实现。
- 证据口径与逐条机器分区在 `EVIDENCE_AUDIT_20260910.md` / `evidence-review.json`；时序 presence epochs 在 `inventory-provenance.json`。
- 当前五个硬门均未闭环：registry/offline 包闭包、rollout durable Session、apply-patch DSH FS authority、subagent prompt consumption、current settings/model/provider import。
- 台账现在显式覆盖 historical anchor→`121f91f` 的漏记窗口、后续两轮审计和 removal/reintroduction。revision-aware Git-object gate 已在 historical anchor **142 manifests** 与 `adee0b0` **151 manifests** 两端 exact-set 通过；153 个时序 row 多出的 2 条是 endpoint 前已删除的 `mcp-server` 与 `mcp-server/tests/common`。
- 默认集成包由 8 个插件组成；`codex-sandbox-bin` 仅为独立资产/状态包，不是 DSH sandbox runtime。

## 现行验收门

| 门 | 验收证据 |
|---|---|
| 台账一致性 | `coverage.yaml` 与 `coverage.json` 当前 153 条语义一致；`evidence-review.json` 覆盖全部 53 条正向记录和 100 条当前排除记录；`inventory-provenance.json` 记录 presence epochs；exact Git-object gate 已在 historical anchor 142 manifests 与 `adee0b0` 151 manifests 两端 exact-set 通过 |
| 等效性提升 | 只有通过真实 DSH consumer、正向/fail-closed、lifecycle/authority/persistence 和 built-artifact 验证的**明确范围**才能升为 runtime-equivalent |
| Profile 组合 | 安装仅修改 profile `package.json`；用户 `cordis.patch.yml` 保持逐字节不变；只添加 `dsh-codex-pack` 一个 bundle layer |
| 产物加载 | 区分 sibling-lib activation、clean registry install、offline multi-tarball、offline single-tarball；不得用 custom importer 证明发布闭包 |
| 包布局 | manifest、实际 package name、built export、`dsh.bundle.patch` 和聚合 patch 顺序一致，任一漂移均 fail loud |
| 代码质量 | 2026-09-10 本工作树 fresh 验证：10 包 **493 passed / 0 failed**，10/10 typecheck 通过，`scripts/rebuild-bundles.mjs --check` 为 10/10、0 drift；这仍不等于 host/runtime gate 通过 |
| 发布证据 | 2026-09-10 已分别查询 aggregate 与 8 个 component 的当前未作用域 public-registry identity，9/9 均返回 404；所有权/最终 identity 与 clean install 未解决前，registry closure 保持 blocked |

## 保持阻断的能力

当前包不提供 DSH 尚无真实消费面的能力：MCP elicitation/user-verification proof、auth/account epoch、remembered approval grant、Guardian retained authorization/assessment、exec-server identity producer、Linux sandbox 重建、daemon/PID/release updater。出现可信 host seam 与 keyless 验证路径前，不以本地类型或模拟器替代。

## 后续顺序

1. 以 `evidence-review.json` 的 100/100 exact-source 分区为准，逐步把 legacy whole-crate `code` / `note` 拆成可审计的 excluded、blocked、split 与 migration-candidate 叙述；不把候选能力计作已实现。
2. 先分别写真实 host-composition red tests，再推进：durable Session、FS-authorized add/update subset、prompt roster、serviceable config mapping。
3. 组件 gate 稳定后再做 clean aggregate install；registry、offline multi-tarball 与 single-tarball 分开验收。
4. 每个 gate 通过后只提升对应的窄范围 ledger row，并记录 consumer、负向测试、生命周期与 built artifact。
5. 最后运行全包测试/typecheck、bundle check、ledger consistency、preflight/dry pack 与 clean install；报告 fresh totals 和所有 blocked/skipped 项。
6. 未经显式授权不提交、推送、发布或修改 DSH host；本地通过不等于 GitHub Actions 通过。
