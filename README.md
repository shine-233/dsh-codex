# dsh-codex-ledger

> The porting ledger & master control for the codex→dsh project.
> 整个 codex→dsh 移植工程的**总控账本**：任何上游单元必须有且只有一个去向，遗漏在数学上不可能发生。

[![ci](https://github.com/shine-233/dsh-codex-ledger/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

一张 142/142 的完整台账 + 校验工具链：

| 文件 | 作用 |
|---|---|
| `coverage.yaml` / `coverage.json` | openai/codex 每一个上游文件的去向（生成于 2026-08-22，锚点 `970b7f2ff4f6`） |
| `scripts/verify_coverage.py` | 重扫上游树与台账比对：新增/缺失/行数漂移都会非零退出 |
| `MIGRATION_PLAN.md` | 最详细执行计划（里程碑/验收/风险） |

去向编码：`R1..R10` = 十个代码仓库；排除码 `E1` OpenAI 服务绑定 / `E2` UI 形态 / `E3` V8 自带 / `E4` Rust 胶水测试 / `E5` 已有等价或 OS 耦合。

## 为什么

移植工程最常见的死法是"漏了一块没人知道"。账本把完整性从"感觉齐了"变成**机器可验证的不变量**：上游每行代码，要么在某个 R 仓库里，要么有一条显式排除理由。

## 快速开始

### 作为 dsh 插件

profile bundles 加入 `"dsh-codex-ledger"`：

```text
→ codex_ledger_status({})
← { "total": 142, "byTarget": { "EXCLUDED": 84, "codex-schema": 22, … },
    "anchor": "openai/codex@970b7f2ff4f6" }
```

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
