# 差分运行器

1. 在仓库根建 `tasks/T01..T20/task.md`（内容取自 docs/differential-tasks.md）
2. `DIFF_CONFIG='{"codex":{"bin":"codex","args":["exec"]},"dsh":{"bin":"dsh","args":["--profile","headless"]}}' node scripts/run-differential.mjs --only=T01`
3. 报告落 `reports/<ID>.<harness>.log`，人工按 docs/differential-tasks.md 指标归档

# 台账双件一致性守卫

`coverage.yaml`（人工真值）与 `coverage.json`（机器镜像，dsh-codex-pack loadLedger / verify_coverage.py 的输入）之间无生成器，靠本脚本保持语义一致（逐条比较 dest/code/status/lines/audit/note + 路径集）：

```
node scripts/check_yaml_json_consistency.mjs        # 检查，漂移则 exit 1 并列出
node scripts/check_yaml_json_consistency.mjs --fix  # 同步：yaml 为 status/code/audit/note 真值；json 独有 dest 反向回填 yaml
```

2026-09-07 首跑即查出 39 处漂移（4 条 stale design-only、3 条 sandbox-bin 改判未同步、多条 audit 滞后、6 条 yaml 缺 dest），--fix 后 [OK]。
