# codex-config-importer

> One-shot migrator from codex config.toml to a dsh cordis.patch.yml overlay.
> 从 codex 迁移到 dsh 的第一步：把 `~/.codex/config.toml` 一键转成 cordis 补丁层。

[![ci](https://github.com/shine-233/codex-config-importer/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

读取 openai/codex 的 `config.toml`（模型、provider、`model_providers` 表），生成等价的 dsh `cordis.patch.yml` 覆盖层文本：

```yaml
# 输入 config.toml
model = "deepseek-chat"
model_provider = "deepseek"

# 输出 cordis.patch.yml 片段
- insert:
    - id: llm-route
      config:
        model: "deepseek-chat"
        providerHint: "deepseek"
```

内置一个够用的 TOML 子集解析器（顶层键、`[section]` 表、标量/数组），零依赖，2/2 单测。

## 为什么

迁移工具链最大的摩擦是配置格式。模型名和 provider 映射手抄必错；这个包让"换壳不换脑"成为复制粘贴的事。

## 快速开始

### 作为 dsh 插件（推荐）

profile bundles 加入 `"codex-config-importer"`：

```text
→ codex_config_import({})                       // 默认读 ~/.codex/config.toml
← - insert:
    - id: llm-route
      config: …
```

把输出粘进 profile 的 `cordis.patch.yml`（或合并进现有条目）即完成迁移。

### 作为独立库

```js
import { tomlToCordisPatch, parseTomlLite } from 'codex-config-importer'

const yml = tomlToCordisPatch('~/.codex/config.toml')  // 找不到文件返回 null
const cfg = parseTomlLite(text)                        // TOML 子集 → JS 对象
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_config_import` | `configPath?`（默认 `~/.codex/config.toml`） | 生成 cordis.patch.yml 文本 |

## API 一览

| 导出 | 说明 |
|---|---|
| `tomlToCordisPatch(cfgPath)` | 主入口；返回 YAML 字符串或 null |
| `parseTomlLite(src)` | TOML 子集解析器 |
| `apply(ctx, config)` | 插件入口 |

## 来源与许可

格式对照 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`。实现原创，Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的迁移模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
