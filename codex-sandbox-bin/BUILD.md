# 构建沙箱工具集

## 依赖
- Rust stable (rustup) + `cargo build -p <crate>` 所需平台工具链
- Windows: MSVC Build Tools；Linux: gcc/libc-dev（Landlock 头随内核 ≥5.13）

## 步骤（上游锚点见 NOTICE.md）
```
# 从上游 checkout 复制 crate 目录后：
cargo build --release -p codex-linux-sandbox      # Linux
cargo build --release -p windows-sandbox-rs       # Windows (MSVC)
cargo build --release -p codex-exec-server        # 精简执行服务
```
产物复制到 `bin/<target-triple>/` 并由 dsh-codex-pack 在安装时分发。

## 本机工具链探测结果
见 scripts/detect.ps1 输出。
