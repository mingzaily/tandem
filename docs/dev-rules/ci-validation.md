# CI 与本地验证

> **状态**：权威
> **读取时机**：修改 relay、PWA、官网或自动化脚本，准备发布之前

## 共享入口

在仓库根目录运行。需要 Node 24、pnpm 10.33.2、Rust 1.91（含 clippy）和 Chrome；容器检查另需可用的 Docker / Buildx。

```sh
# 快速检查自动化脚本：版本晋升、发布组合、失败及中断清理
node --test .github/scripts/*.test.mjs

# relay、PWA、官网和浏览器完整检查
node .github/scripts/verify.mjs

# 追加本机架构镜像的构建与启动验收
node .github/scripts/verify.mjs --image
```

入口会以冻结锁文件安装三个项目的开发依赖，再运行 Rust 单元测试与 clippy、relay 类型检查与 WebSocket 集成测试、PWA 类型检查与单元测试、两个前端的构建，以及站点链接检查。浏览器覆盖根路径和 `/tandem/app/` 的完整协议流程、官网到 PWA 的跳转、安装身份、缓存范围和离线打开。

本机已经安装 Chrome 时直接运行。需要安装浏览器时加 `--install-browser`，使用 Playwright 安装 Chrome 及系统依赖；Linux CI 使用此选项。`CARGO_TARGET_DIR` 可以指定 Rust 构建目录，测试会跟随该目录寻找 relay 二进制。

设置 `TANDEM_CI_ARTIFACTS` 为本机目录可留存截图，按 `root/`、`pages/` 和 `hosting/` 区分。省略时浏览器测试自行清理临时截图。普通构建产物仍位于各项目的原有目录；源码目录保持独立。

## 工作流语法

GitHub 会解析工作流。提交前可使用 [actionlint](https://github.com/rhysd/actionlint) 在本机检查 Actions 语法、表达式、输入和依赖关系：

```sh
actionlint .github/workflows/*.yml
```

actionlint 1.7.12 的 schema 尚未识别 `concurrency.queue`。本仓库的 `queue: max` 已按 [GitHub 官方规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) 核对；该版本使用下面的精确例外检查其余规则：

```sh
actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/*.yml
```

共享脚本执行项目的真实命令，适合本机反复验证。actionlint 负责工作流静态检查；GitHub 的令牌权限、环境配置和托管服务仍需线上验收。

## 容器验收

`--image` 创建独立的临时 Buildx builder，构建本机架构的镜像，完成检查后移除该镜像、builder 及其构建状态。下次容器验收会重新下载和构建这些层；日常改动可以先运行默认入口。它不推送镜像，也不部署站点。

已有本机镜像可单独验收：

```sh
node .github/scripts/container-smoke.mjs tandem-relay:local
```

容器使用随机名称、临时命名卷、动态本机端口、只读根文件系统和移除能力的运行配置。检查非 root、内置健康检查、HTTP 静态页面、PWA 与 fake-host 的实际配对、准入文件权限、重启持久化和 SIGTERM 退出。测试失败打印中转日志；正常、失败、SIGINT 和 SIGTERM 都清理本次容器与命名卷。容器检查使用固定测试令牌和独立浏览器上下文。

## 自动化职责

| 工作流 | 触发 | 验证与产物 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 相关改动进入 main、指向 main 的 PR、其他工作流调用 | macOS 桌面端检查、共享检查和本机架构容器验收；被 relay 发布工作流调用时跳过桌面端检查，容器检查由发布任务执行 |
| `.github/workflows/site-pages.yml` | 相关改动进入 main、手动触发 | 共享检查成功后上传组合产物并发布 Pages；浏览器检查属于发布门禁 |
| `.github/workflows/relay-image.yml` | `relay-v*` tag、手动触发 | 先通过共享检查，再加载并启动 amd64 待发布镜像；成功后构建并推送 amd64 / arm64 版本与 SHA 标签 |

通用 CI 的路径覆盖 `desktop/**`、relay、PWA、官网、自动化文件、协议和测试向量。独立 `macos-15` job 在桌面端运行 typecheck、前端测试、Rust 测试与 `cargo clippy --all-targets -- -D warnings`；第三方 Action 固定到 commit SHA。PR 校验使用只读仓库权限；GHCR 写权限只授予镜像发布与版本晋升任务。桌面端窗口验收、构建和原生互通仍按桌面开发文档执行。

### latest 晋升

metadata-action 显式关闭自动 `latest`。版本与 SHA 标签推送成功后，独立任务按 `relay-latest` 组串行排队，保留最多 100 个等待任务。它读取 GHCR 当前 `latest` 镜像配置中的版本标签，按三个数字版本段比较：

- 正式 `relay-vX.Y.Z` 且高于现有版本时，将已发布的双架构 digest 晋升到 `latest`。
- 首次发布的 `latest` 返回 404 时，允许正式版本建立该标签。
- 旧版本、同版本重跑、预发布和手动分支构建保留各自版本／SHA 标签。
- GHCR 准入、网络、服务错误或现有版本标签无法识别时，结束晋升并报告原因，保留当前 `latest`。

串行队列覆盖并发更新；版本比较覆盖旧版本重跑和构建完成顺序变化。`relay-release.mjs` 只有显式 `--publish` 才执行晋升，普通本地验证只运行其隔离测试。

## 验证边界

本地可以覆盖项目逻辑、页面行为、工作流静态语法和本机架构容器。`--image` 在 Apple Silicon 上构建 arm64，在 Ubuntu amd64 runner 上构建 amd64；另一个架构由发布工作流构建。GHCR 权限、真实标签推送、Pages 配置、线上域名、真机安装和公网 WSS 需分别在线上或真机验收。测试使用 fake-host，真实桌面互通另运行 `relay/` 的 `pnpm interop`。
