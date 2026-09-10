# dsh-codex-ledger

> The porting ledger & master control for the codex→dsh project.
> 整个 codex→dsh 移植工程的**总控账本**：任何上游单元必须有且只有一个去向，遗漏在数学上不可能发生。

[![ci](https://github.com/shine-233/dsh-codex-ledger/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

一张当前含 **153 个时序 row** 的迁移清单、独立的等效性证据审查和校验工具链。YAML/JSON 两份清单当前 153/153 语义一致；revision-aware Git-object gate 已在历史锚点 `970b7f2ff4f6`（142 manifests）与审查终点 `adee0b04`（151 manifests）分别通过 exact-set 校验。153 个 row 不是任一端点的 crate 数量：它保留了终点前删除的两个历史 crate，并登记了三个后续新增 crate。清单中的 `implemented` / `distilled` 只表示代码去向，**不等于运行时等效**；证据等级见 [`EVIDENCE_AUDIT_20260910.md`](./EVIDENCE_AUDIT_20260910.md) 与机器镜像 [`evidence-review.json`](./evidence-review.json)。

| 文件 | 作用 |
|---|---|
| `coverage.yaml` / `coverage.json` | openai/codex 上游单元的迁移去向；历史来源锚点为 `970b7f2ff4f6`，后续 review range 单独记录 |
| `inventory-provenance.json` | 记录 historical/incremental inventory class、引入/删除/重引入 presence epochs 与 review windows |
| `EVIDENCE_AUDIT_20260910.md` / `evidence-review.json` | 区分正向 evidence class，并对当前 100 条排除记录给出逐条 exact-source disposition |
| `scripts/verify_coverage.py` | 从指定 revision 的 Git object tree 重建 Cargo manifest 集合，再按 provenance presence epochs 重建该 revision 应存在的 ledger 集合并做 exact-set 比较；默认历史 anchor，可用 `--revision` 检查增量终点；不验证行为等效、测试或 runtime consumer |
| `scripts/check_yaml_json_consistency.mjs` | 检查 YAML/JSON 语义镜像、证据分类计数、exact disposition 分区与 provenance 基本不变量 |
| `MIGRATION_PLAN.md` | 执行顺序、验收门和阻断能力 |

去向编码：`R1..R10` = 十个代码仓库；排除码 `E1` OpenAI 服务绑定 / `E2` UI 形态 / `E3` V8 自带 / `E4` Rust 胶水测试 / `E5` 已有等价或 OS 耦合。

## 为什么

移植工程最常见的死法是"漏了一块没人知道"。账本把完整性从"感觉齐了"变成**机器可验证的不变量**：上游每行代码，要么在某个 R 仓库里，要么有一条显式排除理由。

## 快速开始

### 作为 dsh 插件

profile bundles 加入 `"dsh-codex-ledger"`：

```text
→ codex_ledger_status({})
← { "total": 153, "byTarget": { "EXCLUDED": 100, … },
    "anchor": "openai/codex@970b7f2ff4f6" }
```

该工具报告迁移清单，不报告等效完成度。2026-09-10 的 53 条正向记录审查结果为：0 runtime-equivalent、9 behavioral-subset、6 structural-only、37 implemented-unconsumed、1 unsupported-overclaim。原 97 条排除记录的首轮 78/1/18 口径已被精确源码复核取代；补录三个 endpoint crate 后，当前 100 条排除记录已全部裁决为 37 split、13 blocked、38 excluded、12 migration-candidate。`split` 与 `migration-candidate` 都不表示能力已经实现。

### 校验脚本（需要上游 checkout）

```bash
git clone https://github.com/openai/codex upstream-codex
python scripts/verify_coverage.py --upstream ./upstream-codex
echo $?   # 0 = 台账与上游一致
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_ledger_status` | — | 台账总量、去向分布、锚点版本 |

## 来源与许可

对照对象 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`。账本与脚本原创，Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的总控；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
