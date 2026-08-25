# AGENTS.md — codex-session-kit

定位：rollout 容错读取、SQLite 镜像索引、MemoryStore、Claude Code 导入器

跑起来：`npm install && npx vitest run`（R8 为 Rust：见 BUILD.md）

技术栈：TypeScript(ESM)+vitest

约定：源码 src/，测试 test/；源自 openai/codex@970b7f2ff4f6 (Apache-2.0)，勿引入其许可证冲突依赖。

状态：✅ 本地 PASS（CI 复核中）。台账唯一事实源：dsh-codex-ledger/coverage.yaml。
