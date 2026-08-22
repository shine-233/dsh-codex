# dsh-codex-ledger

> 整个 codex→dsh 移植工程的**总控账本**：任何上游单元必须有且只有一个去向，遗漏在数学上不可能发生。

## 文件
- `coverage.yaml` / `coverage.json` —— 全部上游 manifest 的去向台账（生成于 2026-08-22，锚点 openai/codex@970b7f2ff4f6）
- `scripts/verify_coverage.py` —— 重扫上游树并与台账比对；新增/缺失/行数漂移都会非零退出
- `MIGRATION_PLAN.md` —— 最详细执行计划（里程碑/验收/风险）

## 去向编码
`R1..R10` 对应十个代码仓库；排除码：E1 OpenAI服务绑定 / E2 UI形态 / E3 V8(Node自带) / E4 Rust胶水测试 / E5 已有等价或OS耦合

## 用法
```
python scripts/verify_coverage.py --upstream <path-to-codex-checkout>
```
退出码 0 = 台账与上游一致。
