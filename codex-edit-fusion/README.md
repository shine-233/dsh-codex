# codex-edit-fusion

> 面向 DeepSeek Harness 的单目标 V4A 补丁工具；匹配算法移植自 openai/codex apply-patch。

[![ci](https://github.com/shine-233/codex-edit-fusion/actions/workflows/ci.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 两个使用面

### DSH 工具

插件注册 `codex_apply_patch`，参数只有完整的 `patch` 文本。模型可提交：

- 恰好一个 `*** Add File`；或
- 恰好一个 `*** Update File`，其中可包含多个 hunk。

工具在访问文件系统前拒绝空操作、Delete、Move/Rename、混合操作及多个文件声明。相对路径从当前 Session 的不可变 `cwd` 解析；模型不能另传工作目录。

```text
codex_apply_patch({
  patch: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-const greeting = \"hello\"\n+const greeting = \"hello, dsh\"\n*** End Patch"
})
```

Add 通过 DSH 文件系统执行一次 `createIfAbsent` 写入；Update 先读取版本，再执行一次 `replaceIfVersion` 写入。并发修改会以 `FS_STALE_VERSION` 失败而不覆盖竞争写入。调用的取消信号和每次调用解析出的 sandbox policy 均传给后端；实际写权限由挂载的 DSH 文件系统实现决定。

每个已接受的补丁只发布一次原子后端写入。本包不提供多文件事务，因为模型工具不接受多文件补丁。

### 独立解析库

`parsePatch()` 和 `applyPatch()` 保留较宽的内存 API，可解析 Add、Delete、Update、Move/Rename 和多文件补丁。`applyPatch()` 操作调用者提供的 `Map`，不访问主机文件系统，也不代表 DSH 工具允许同样的操作。

```js
import { parsePatch, applyPatch } from 'codex-edit-fusion'
import { readFileSync } from 'node:fs'

const patch = parsePatch(patchText)
const files = new Map([['app.ts', readFileSync('app.ts', 'utf8')]])
const { files: out, results, errors } = applyPatch(patch, files)
```

## 匹配

Update hunk 依次尝试：精确匹配、忽略行尾空白、忽略行首尾空白、Unicode 标点归一。弯引号、Unicode 破折号和常见非标准空格可与 ASCII 形式匹配。DSH 工具将写回内容归一为 LF。

## DSH 组合要求

插件需要 `ctx.tools` 与 `ctx.fs`。若文件系统声明 sandbox mode，还必须安装 `ctx.sandboxPolicy`；缺失时插件加载失败。当前集成验证基于 DeepSeek Harness `0.1.3-alpha.1`、Cordis `4.0.2` 和 Schemastery `3.18.2`。

profile 的 `package.json` 声明依赖和 bundle 后，包内 `cordis.patch.yml` 会插入 `codex-edit-fusion`。真实 Loader/Include `cordis.yml` 启动、工具注册与 fiber dispose 注销均有集成测试覆盖。

## API

| 导出 | 说明 |
|---|---|
| `parsePatch(text)` | 解析 V4A 文本为结构化 Patch |
| `applyPatch(patch, files, locate?)` | 将补丁应用到内存文件 Map |
| `seekSequence(lines, pattern, start, eof?, mode?)` | 四级降级模糊定位 |
| `apply(ctx, config)` | DSH 插件入口 |
| `Config`, `name`, `inject` | DSH 插件元数据 |

## 已知限制

- 模型工具不支持 Delete、Move/Rename 或多文件补丁；这些仅存在于独立内存 API。
- 目录创建、路径 containment、临时目录例外及 denial 文案由所挂载的 DSH 文件系统与 sandbox policy 所有。
- 本包没有多文件回滚或事务语义。

## 来源与许可

移植自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6`（`codex-rs/apply-patch`），上游 Apache-2.0。详见 [NOTICE.md](./NOTICE.md)。

本仓库是 **codex→dsh 移植套件**的编辑模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
