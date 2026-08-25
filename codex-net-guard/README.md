# codex-net-guard

> Pure-JS network whitelist proxy for agent sandboxes — ported from openai/codex network policy ideas.
> 给 agent 沙箱加一道纯 JS 的网络闸门：白名单域名放行，其余一律 403。

[![ci](https://github.com/shine-233/codex-net-guard/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

一个零依赖的本地 HTTP + CONNECT 代理：

- **后缀匹配**：`example.com` 同时放行 `api.example.com`、`cdn.example.com`
- HTTP 明文请求与 HTTPS CONNECT 隧道都管
- 拦截即 403，被拒域名一目了然
- 纯 Node 实现，不碰 iptables/系统代理，3/3 单测覆盖

作为 dsh 插件时提供 `codex_net_guard` 工具，agent 或用户可随时启停、换白名单。

## 为什么

让 agent 联网干活（拉包、查文档）很必要，但裸放行等于把整个内网和任意域名交给一个会幻觉的模型。codex 的网络审批思路是**默认拒绝、显式白名单**——这个包把同样的安全模型带进 dsh，且不用装任何原生组件。

## 快速开始

### 作为 dsh 插件（推荐）

profile bundles 加入 `"codex-net-guard"`。默认不启动，两种启用方式：

```yaml
# 方式一：cordis.patch.yml 里配置 autostart
- id: codex-net-guard
  config:
    autostart: true
    allowedDomains: ["api.deepseek.com", "github.com", "registry.npmjs.org"]
```

```text
方式二：对话里让模型调用工具
→ codex_net_guard({ action: "start", domains: ["github.com"] })
← {"running": true, "url": "http://127.0.0.1:53211", "domains": ["github.com"]}
```

拿到 URL 后把它设为子进程的 `HTTP_PROXY/HTTPS_PROXY` 即完成沙箱收口；`action:"stop"` 一键关闭。

### 作为独立库

```js
import { createWhitelistProxy } from 'codex-net-guard'

const proxy = createWhitelistProxy({ allowedDomains: ['api.deepseek.com'], port: 0 })
proxy.url()   // "http://127.0.0.1:<实际端口>"（listening 后稳定）
proxy.close()
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_net_guard` | `action: start/stop/status`, `domains?`, `port?` | 启停/查询本地白名单代理 |

## API 一览

| 导出 | 说明 |
|---|---|
| `createWhitelistProxy(opts)` | `{ server, url(), port(), close() }` |
| `apply(ctx, config)` | 插件入口；支持 `autostart` / `allowedDomains` / `port` |

## 来源与许可

设计移植自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6` 网络策略，上游 Apache-2.0。实现为原创纯 JS。详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的网络模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
