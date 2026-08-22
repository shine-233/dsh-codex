# codex-sandbox-bin

> Vendored cross-platform sandbox executables from openai/codex, wired as a DeepSeek Harness plugin.
> openai/codex 官方沙箱可执行文件的 vendored 分发 + dsh 就绪检测插件：开箱知道有没有、路径在哪。

[![build](https://github.com/shine-233/codex-sandbox-bin/actions/workflows/build-sandbox-bins.yml/badge.svg)](../../actions)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

## 这是什么

两件事：

1. **二进制分发**：把 openai/codex 的跨平台沙箱工具原样 vendor 进仓库（云端编译产物，装机实测）：
   - `bin/windows-x64/codex-command-runner.exe`（7.6 MB）
   - `bin/windows-x64/codex-windows-sandbox-setup.exe`（14 MB）
   - `bin/linux-x64/codex-linux-sandbox`（47 MB，Landlock 沙箱）
2. **dsh 插件**：提供 `codex_sandbox_status` 工具，按当前平台自动定位二进制、报告绝对路径与大小——配置 `sandbox-policy` 时直接抄路径。

## 为什么

沙箱执行体是最难分发的部分：Rust 编译、平台各异。codex 已经解决了构建问题，重复造轮子没有意义；但"怎么知道我这台机器能不能用、路径是什么"没人管——这个包补上最后一厘米。

## 快速开始

### 作为 dsh 插件

profile bundles 加入 `"codex-sandbox-bin"`，对话里：

```text
→ codex_sandbox_status({})
← {
    "platformKey": "windows-x64",
    "dir": ".../codex-sandbox-bin/bin/windows-x64",
    "binaries": { "codex-command-runner.exe": { "path": "…", "bytes": 7958528 }, … },
    "available": true
  }
```

拿到路径后即可在 `cordis.patch.yml` 里接线：

```yaml
- insert:
    - id: sandbox-policy
      config:
        mode: workspace-write
        sandboxBin: "<status 返回的可执行文件绝对路径>"
```

### 独立使用二进制

```powershell
# Windows 命令 runner 走 pipe 协议（stdin 传入任务描述）
Get-Content task.txt | & .\bin\windows-x64\codex-command-runner.exe
```

## 在 dsh 里提供的工具

| 工具名 | 参数 | 作用 |
|---|---|---|
| `codex_sandbox_status` | — | 当前平台沙箱二进制的就绪检测与绝对路径 |

## 来源与许可

二进制来自 [openai/codex](https://github.com/openai/codex)@`970b7f2ff4f6` 云端构建，Apache-2.0。未做任何修改，详见 [BUILD.md](./BUILD.md) 与 [NOTICE.md](./NOTICE.md)。

---

本仓库是 **codex→dsh 移植套件**的沙箱模块；总览见 [dsh-codex-pack](https://github.com/shine-233/dsh-codex-pack)。
