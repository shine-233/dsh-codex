# codex-config-importer

> 判⑧缩水产物：dsh 配置体系全面胜出，此仓只做一次性迁移与公共微件。

## 吸收来源
- config (22,666, 仅 TOML 解析层)
- model-provider-info (1,166, provider 预设字典)
- features/context-fragments/response-debug-context/terminal-detection
- utils 微件群: path-uri/path-utils/absolute-path/home-dir/stream-parser/template/string/json-to-toml/redacted-string/cache/elapsed/fuzzy-match/readiness

## 功能边界
**做**：读 codex config.toml 并转出 cordis.patch.yml；路径规范化、模板、模糊匹配等公共函数。

**不做**：不替代 dsh 自身配置系统；不管理密钥。

## API 草图
```
importConfig(tomlPath): CordisPatch
normalizePath(p): string
```

## 验收标准
真实 config.toml 无损转出可用 patch；微件单测覆盖 ≥95%。

## 上游同步
基于 openai/codex@970b7f2ff4f6（Apache-2.0）。季度 diff 由 dsh-codex-ledger CI 触发，见 ledger/coverage.yaml 对应行。
