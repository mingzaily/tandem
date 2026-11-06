# 环境准备

> **状态**：权威
> **读取时机**：首次搭建开发环境

需要 Rust 1.91 或更新、Node.js 24、pnpm 10、Xcode 命令行工具，以及至少一个用户自己安装并登录好的 CLI（`claude`、`codex` 或 `pi`）。目前只支持 macOS。

```bash
cd desktop
pnpm install
pnpm tauri dev
```

首次编译 Rust 依赖需要几分钟，`desktop/src-tauri/target/` 约占 2 GB，已被 Git 忽略。
