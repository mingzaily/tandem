# Tandem

个人自用的轻量桌面客户端，用 Tauri 驱动用户自己安装的 Claude Code、Codex 和 Pi。

- 桌面端：[`desktop/`](desktop/)
- 手机端 PWA：[`pwa/`](pwa/)（未开始）
- 自建中转：[`relay/`](relay/)（未开始）
- 规范与工程管理：[`docs/`](docs/README.md)

## 运行

需要 Rust、Node.js、pnpm，以及用户自己安装并登录好的 `claude`。

```bash
cd desktop
pnpm install
pnpm tauri dev
```

## 许可

Apache License 2.0。设计规范、token 和中转代码来自 [Cindy](https://github.com/makecindy/cindy)，详见 [NOTICE](NOTICE)。
