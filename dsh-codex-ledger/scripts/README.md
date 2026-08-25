# 差分运行器

1. 在仓库根建 `tasks/T01..T20/task.md`（内容取自 docs/differential-tasks.md）
2. `DIFF_CONFIG='{"codex":{"bin":"codex","args":["exec"]},"dsh":{"bin":"dsh","args":["--profile","headless"]}}' node scripts/run-differential.mjs --only=T01`
3. 报告落 `reports/<ID>.<harness>.log`，人工按 docs/differential-tasks.md 指标归档
