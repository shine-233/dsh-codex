# codex-sandbox-bin

> 随 dsh 分发的原生小工具集——用户不需要安装 codex。

## 吸收来源
- linux-sandbox (8,631 Landlock+seccomp)
- windows-sandbox-rs (18,491 AppContainer+WFP)
- shell-escalation (2,078) / bwrap (135) / sandboxing (7,797 编排)
- process-hardening (165 内联) / diagnostics (238) / utils/sandbox-summary (172)
- exec-server (44,453 精简为最小执行服务)

## 功能边界
**做**：统一 CLI：dsh-sandbox run --policy x -- cmd；三平台同一策略语义；进程加固内联。

**不做**：不是通用容器方案；不做网络代理（那是 net-guard 的事）。

## API 草图
```
dsh-sandbox run --policy policy.json -- <cmd>
```

## 验收标准
三平台同一策略文件跑通；越界读写/联网被内核级拦截。

## 上游同步
基于 openai/codex@970b7f2ff4f6（Apache-2.0）。季度 diff 由 dsh-codex-ledger CI 触发，见 ledger/coverage.yaml 对应行。
