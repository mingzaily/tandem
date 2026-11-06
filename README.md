<p align="center">
  <img src="docs/brand/tandem-icon.svg" width="96" height="96" alt="Tandem">
</p>

<h1 align="center">Tandem</h1>

<p align="center">一个轻快的桌面客户端，统一驱动 Claude Code、Codex 和 Pi。</p>

<p align="center">
  <a href="https://github.com/mingzaily/tandem/releases">下载</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#手机访问">手机访问</a> ·
  <a href="#参与开发">参与开发</a>
</p>

---

Tandem 把你已经在用的 AI 编程 CLI 放进同一个原生窗口。它基于 Tauri 和 Rust 构建，启动快、占用低，任务记录直接来自各 CLI 自己的会话文件，在终端和 Tandem 里看到的始终是同一份。

## 特性

**一个界面，三个 Agent**

- 同时使用 Claude Code、Codex 和 Pi，任务按项目分组，支持搜索、置顶、归档和重命名
- 按 Agent 切换模型和推理强度，显示每个模型实际的默认级别
- 新建、续接和停止任务，支持 Claude Code 的 worktree
- 不选项目也能开始：独立的对话分组，随手问一句

**看得清，管得住**

- 工具授权和 Agent 的提问显示成卡片，一次允许或整个任务允许
- 工作过程自动折叠，随时展开查看命令、文件改动和思考
- 实时查看生成速度曲线、峰值、上下文占用和套餐额度
- 任务开在终端或其他程序时会提示并跟随刷新，避免记录写分叉
- 运行中继续发消息：排队发送，可以排序、编辑和删除

**随时随地**

- 菜单栏面板：关掉窗口也能继续运行，一眼看到额度和进行中的任务
- 任务完成或等你确认时发送系统通知
- 手机访问：通过自建中转服务连接手机 PWA，内容端到端加密

**细节**

- 粘贴图片、拖入文件，图片可放大查看
- 多套内置主题，支持深色模式
- 中文和英文界面

## 设计原则

- **你的 CLI，你做主。** 使用你环境里安装的 CLI，不内置、不托管、不自动更新。只有你在设置里点“安装”时，才通过 npm 全局安装。
- **不碰你的配置。** 不写 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.pi/agent/*.json`，需要的内容都走启动参数。
- **任务属于你。** 没有私有数据库，不做双写，删掉 Tandem 也不会丢任何任务。
- **不上报。** 没有遥测、崩溃上报和账号体系。

## 快速开始

从 [Releases](https://github.com/mingzaily/tandem/releases) 下载 macOS 安装包（`.dmg`）。

打开 Tandem，在“设置 → Agent”里确认 CLI 状态。还没安装或登录的，可以直接在这里完成。Pi 的模型和密钥请用 cc-switch、magpie 等工具配置。

## 手机访问

Tandem 可以通过你自己部署的中转服务连接手机。桌面端和手机都主动连接中转，桌面端不开放任何端口；内容端到端加密，中转只负责转发，看不到任务内容。

```yaml
# docker-compose.yml
services:
  tandem-relay:
    image: ghcr.io/mingzaily/tandem-relay:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8787:8787"
    environment:
      TANDEM_RELAY_HOST_TOKEN: 换成足够长的随机值
      TANDEM_RELAY_TRUST_PROXY: "1"
    volumes:
      - tandem-relay-data:/data

volumes:
  tandem-relay-data:
```

镜像不包含 TLS，请用你自己的 nginx、Caddy 等网关反向代理，并对外提供 `wss://`。然后在“设置 → 远程”里填写地址和令牌，用手机扫码配对即可。丢失手机时，在电脑上撤销它。

## 参与开发

需要 Rust 1.91 或更新、Node.js 24、pnpm 10。

```bash
cd desktop
pnpm install
pnpm tauri dev                      # 开发运行
pnpm typecheck && pnpm test         # 前端检查
(cd src-tauri && cargo test)        # 后端测试
pnpm tauri build                    # 打包
```

| 目录 | 内容 |
|---|---|
| [`desktop/`](desktop/) | 桌面客户端：`src/` 是界面，`src-tauri/` 是 Rust 后端 |
| [`pwa/`](pwa/) | 手机端 PWA |
| [`relay/`](relay/) | 中转服务 |
| [`site/`](site/) | 文档站和官网 |
| [`docs/`](docs/README.md) | 开发文档：产品、设计和工程规则 |

动手前请先读 [文档索引](docs/README.md)。AI Agent 的工作入口在 [`AGENTS.md`](AGENTS.md)。

## 致谢

灵感来源于 [Cindy](https://github.com/makecindy/cindy)。

## 许可

[Apache License 2.0](LICENSE)
