# Tandem：Agent 工作入口

> Codex 与 Claude Code 共用的项目指令。`CLAUDE.md` 只保留 `@AGENTS.md`。

## Tandem 是什么

面向个人工作流的轻量 macOS 桌面客户端，用 Tauri 驱动用户自己安装的 Claude Code、Codex、Pi。桌面相关改动进入主分支 `main` 后，通过检查即由 CI 自动构建和发布安装包，规则见 [CI 与本地验证](docs/dev-rules/ci-validation.md)。界面复刻 Cindy 的视觉规范，代码不是 Cindy 的 fork，也不跟进上游。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `docs/` | 产品、设计、开发规则和工程管理文档 |
| `desktop/` | 桌面客户端：`src/` 是界面，`src-tauri/` 是 Rust 后端，`design/tokens/` 是设计 token |
| `pwa/` | React 手机端 PWA：加密配对、任务查看与控制、离线应用壳 |
| `relay/` | Rust 自建中转：设备准入、密文转发、PWA 静态托管和容器部署 |
| `site/` | VitePress 官网和部署文档，Pages 产物包含手机端 |

`docs/reference/repos/` 下有 Cindy 和 ccgui 的代码，供实现时查阅，不上传，也不要改。

## 动手前先读

文档总索引：[`docs/README.md`](docs/README.md)。按改动类型读对应规则：

- 任何改动：[核心产品原则](docs/product-rules/core-product-principles.md)、[开发工作流](docs/dev-rules/development-workflow.md)
- 界面和文案：[设计规则](docs/design-rules/README.md)、[任务命名](docs/product-rules/task-and-conversation-naming.md)
- 桌面端代码：[Desktop 开发](docs/dev-rules/desktop-development.md)、[工程规范](docs/dev-rules/engineering-conventions.md)、[架构不变量](docs/dev-rules/architecture-invariants.md)
- 进程、命令和文件读写：[安全与进程边界](docs/dev-rules/security-and-process-boundaries.md)、[凭证与本地存储](docs/dev-rules/credentials-and-local-storage.md)
- 任务数据：[原生会话](docs/dev-rules/native-sessions.md)

## 不可违背的原则

- **用用户环境里的 CLI**：不内置、不托管、不自动更新 agent 二进制。只有用户在设置里点“安装”时，才用用户的 npm 全局安装。
- **不改用户的 CLI 配置**：不写 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.pi/agent/*.json`。需要注入的内容走启动参数。
- **不上报**：没有遥测和崩溃上报，不连接 Cindy 服务端。应用更新使用 Tandem 的 GitHub Releases，可手动检查下载，或按用户开启的自动更新设置定期检查下载；安装和重启始终由用户确认。
- **不用 Cindy 的品牌**：用户可见处不出现 Cindy 的名称、Logo 和角色形象。保留 `LICENSE`、`NOTICE`。

## 常用命令

```bash
cd desktop
pnpm install
pnpm tauri dev                      # 开发运行
pnpm typecheck && pnpm test         # 前端检查
(cd src-tauri && cargo test)        # 后端测试
pnpm tauri build --bundles app      # 本机打包
```

## 协作约定

- 界面文案和报告默认用中文，提交信息用英文。
- 不要 commit、push、改写历史，除非用户明确要求。
- 不要模拟鼠标或键盘操作窗口，用调试版的页面脚本驱动，见 [Desktop 开发](docs/dev-rules/desktop-development.md)。
