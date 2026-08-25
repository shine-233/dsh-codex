# dsh-codex-ui

> Dashboard for the codex→dsh absorbed capabilities, bootable from inside dsh.
> codex→dsh 吸收能力的仪表盘：零依赖静态服务，可在 dsh 会话里一键拉起。

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

一个单文件 Node HTTP 服务 + 静态原型页，可视化展示移植套件各模块的状态与挂载点。两种用法：

1. **独立跑**：`npm start` → `http://127.0.0.1:7777`
2. **dsh 插件**：对话里调用 `codex_ui_url` 工具即自动启动并返回地址（也可 `autostart: true` 随宿主拉起）

零依赖（只用 node:http / node:fs），不与 dsh Web UI 抢端口时可长期驻留。

## 为什么

"移植了什么、接到哪了"不该靠翻台账。一张面板让吸收进度对人和 agent 都可读。

## 快速开始

### 作为 dsh 插件

profile bundles 加入 `"dsh-codex-ui"`：

```text
→ codex_ui_url({})
← { "url": "http://127.0.0.1:7777" }
```

或在 `cordis.patch.yml` 里随宿主自启：

```yaml
- id: dsh-codex-ui
  config:
    autostart: true
    port: 7777
```

### 独立运行

```bash
npm start          # → http://127.0.0.1:7777
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_ui_url` | — | 拉起（幂等）并返回仪表盘地址 |

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `autostart` | `false` | 宿主启动时即开服 |
| `port` | `7777` | 监听端口（仅绑 127.0.0.1） |

## 来源与许可

面板原创；展示的数据来自同套件各模块。Apache-2.0，详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的 UI 模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
