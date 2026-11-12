# CI 与本地验证

> **状态**：权威
> **读取时机**：修改桌面发布、relay、PWA、官网或自动化脚本，准备发布之前

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
| `.github/workflows/ci.yml` | relay / PWA / site、共享 token、相关自动化与协议改动进入 main 或指向 main 的 PR；其他工作流调用 | 共享检查和本机架构容器验收；供 relay 发布复用时容器检查由镜像任务承担 |
| `.github/workflows/desktop.yml` | 桌面相关 PR、桌面发布工作流调用 | typecheck、前端与 Rust 测试、clippy；传入日期版本时同步版本并构建、验证和上传通用 `.dmg` |
| `.github/workflows/desktop-release.yml` | 桌面及发布工具改动进入 main、手动选择 main 执行 | 预留日期版本 → 桌面检查及打包 → 上传完整产物后发布 GitHub Release |
| `.github/workflows/site-pages.yml` | site / PWA、共享 token 及 Pages 构建工具改动进入 main；手动触发 | 共享检查成功后上传组合产物并发布 Pages；浏览器检查属于发布门禁 |
| `.github/workflows/relay-image.yml` | relay、镜像内 PWA / token 及构建工具改动进入 main；手动选择 main 执行 | 预留独立日期版本，先通过共享检查和 amd64 容器验收，再推送 amd64 / arm64 版本与 SHA 标签 |

通用 CI 覆盖 relay、PWA、官网、共享设计 token、相关自动化、协议、测试向量和镜像许可证。桌面源码和桌面发布脚本由独立桌面工作流检查。桌面检查通过可复用工作流在 `macos-15` 上运行，包含发布脚本测试、版本一致性、typecheck、前端测试、Rust 测试与 `cargo clippy --all-targets -- -D warnings`。main 上的桌面相关 push 随发布执行桌面检查，桌面相关 PR 直接触发同一可复用工作流；relay 发布只依赖共享检查。第三方 Action 固定到 commit SHA。构建任务使用只读仓库权限；桌面版本预留与发布任务使用 `contents: write`，GHCR 写权限只授予镜像发布与版本晋升任务。桌面端窗口验收和原生互通仍按桌面开发文档执行。

## 路径与发布边界

GitHub 的 `branches` 和 `paths` 同时满足时才自动触发；一次 push 同时修改多类目录时，各自工作流分别执行。手动触发保留用于重跑和运维。

| 改动 / 动作 | 桌面检查或发布 | Pages 部署 | 共享 / 容器检查 | GHCR 发布 |
|---|---|---|---|---|
| `desktop/**`，共享 token 除外 | PR 检查；main 发布 | — | — | — |
| `site/**` | — | main 部署 | 执行 | — |
| `pwa/**` | — | main 部署 | 执行，包含镜像内 PWA | main 发布 |
| `relay/**` | — | — | 执行 | main 发布 |
| `desktop/design/tokens/**` | PR 检查；main 发布 | main 部署 | 执行 | main 发布 |
| 桌面构建 / 发布 workflow 和 `desktop-release*.mjs` | PR 检查；main 发布 | — | — | — |
| Pages workflow、`build-pages.mjs`、`verify.mjs`、`automation.test.mjs` | — | main 部署 | 执行 | — |
| 共用 `run.mjs` | PR 检查；main 发布 | main 部署 | 执行 | main 发布 |
| 共用日期版本模块 `release-version.mjs` | PR 检查；main 发布 | — | 执行 | main 发布 |
| relay 发布工具、共享 CI、`verify.mjs`、容器检查、镜像许可证 | — | 按上方 Pages 工具范围部署 | 执行 | main 发布 |
| 协议文档、测试向量 | — | — | 执行 | — |
| 普通内部文档 | — | — | — | — |

Pages 仍执行 PWA 与 relay 的浏览器集成门禁，但仅在实际前端或构建依赖变化时部署。纯 relay 或协议修改通过共享 CI 验证；它们不改变已部署的官网 / PWA。桌面发布和 PR 检查采用同一组路径，纯官网、PWA、relay 改动保持 macOS 工作流静默。

官网和 PWA 随 main 的部署提交 SHA 标识构建，不手动维护独立发布号。桌面与 relay 共用 `major.minor.YYYYMMDDNN` 日期规则，各自使用 `v<version>` 和 `relay-v<version>` tag 独立计数；同一天或同一个提交的两个产物也可以有不同版本。通信协议继续使用自身的 `v: 1`，与产品版本分别管理。

relay 镜像包含一份 PWA 和共享 token，因此 PWA 及 token 改动也自动触发 GHCR 镜像发布，确保镜像中的手机端更新。纯 site 改动只部署 Pages。relay 相关改动进入 main 后直接分配独立日期版本，构建并推送 `ghcr.io/mingzaily/tandem-relay:relay-v<version>`、`:sha-<commit>`，验证通过后晋升 latest；无需手动推送 tag。

## 桌面自动发布

`main` 是可发布分支。包含 `desktop/**` 或桌面构建发布工具变更的 push（包括直接提交和合并 PR）触发一次桌面发布；一次 push 内的多个提交只构建最后一个提交。用户无需手动打 tag 或点击 Release 确认。手动运行工作流也只接受 main。桌面相关 PR 执行检查，正式发布由 main 的路径匹配 push 事件驱动。

发布工作流按 `desktop-release` 组串行排队（`queue: max`），一次运行覆盖版本预留、构建和发布三个阶段。失败任务停止发布；源码和用户安装的应用保持独立。桌面发布门禁覆盖桌面检查，relay / PWA / 官网各自使用现有检查和发布链路。

### 版本规则

- 源码中的 `desktop/package.json`、`desktop/src-tauri/tauri.conf.json`、`Cargo.toml` 和 `Cargo.lock` 的 Tandem 包版本保持一致，采用 `major.minor.0`，当前为 `0.1.0`。
- CI 分配 `major.minor.YYYYMMDDNN`，例如 `0.1.2026111101`。日期采用 `Asia/Shanghai`，当日序号为 `01`–`99`；达到上限后明确失败，次日重新从 `01` 起。
- 版本以指向源码提交 SHA 的 `v<version>` tag 预留。构建失败或中断保留这个 tag，同提交重跑复用原版本，序号允许有间隔。
- CI 在临时工作区同步四处版本，打包产物使用日期发布号；源码提交保留产品阶段版本。流水线使用 GitHub API 创建 tag，构建阶段沿用只读权限。
- 已发布的同一提交跳过重复发布；完整重跑的旧提交在已被新版本覆盖时跳过。旧任务只重跑失败 job 时也保持旧版本号，发布器按数字版本比较保护 Latest。
- 已公开的产物保持原样；上传中断留下草稿，重跑只替换草稿内的产物，全部上传成功后才公开。

### 产物与签名

CI 安装两种 Rust target，构建 `universal-apple-darwin` 通用应用，同一个 `.dmg` 支持 Apple Silicon 和 Intel。产物上传前验证 plist 的两处版本、Mach-O 的双架构与应用代码签名。

`bundle.macOS.signingIdentity` 使用 `-`，即免费的 ad hoc 签名。当前发布采用该方式；它验证应用包自身一致性，用户首次打开仍可能需要在“系统设置 → 隐私与安全性”中允许。Developer ID 和 Apple 公证需要后续接入开发者证书。

Release 包含 `Tandem_<version>_universal.dmg`、`Tandem.app.tar.gz`、`Tandem.app.tar.gz.sig`、`latest.json` 和 `SHA256SUMS`。更新清单为 `darwin-aarch64` 与 `darwin-x86_64` 提供同一个通用更新包，URL 指向不可变版本 tag；发布器只在全部产物上传后公开 Release。临时 Actions 产物保留 7 天，Release 按版本保存。

“设置 → 关于”提供检查、下载和安装重启入口。应用从 `https://github.com/mingzaily/tandem/releases/latest/download/latest.json` 读取清单，自动更新默认关闭；开启后由 Rust 按 1、6、12、24 小时间隔检查并下载，默认 6 小时，首次检查最早在启动 30 秒后执行。官方更新器校验签名和签名绑定版本（`requireSignedVersion`），安装与重启始终由用户确认。后台调度和下载状态独立于设置页挂载，失败等待所选间隔，已就绪更新暂停定期检查。更新签名使用 `TAURI_SIGNING_PRIVATE_KEY` Actions Secret，公钥写在 Tauri 配置中。私钥本机保存在 `~/.local/share/tandem-release/updater.key`，目录 `0700`、私钥 `0600`；它与 Apple ad hoc 签名独立。需要在新仓库配置 Secret 时从文件标准输入传给 `gh secret set`，保持密钥原值并妥善备份。

仓库目前为私有，维护者后续改为公开后，应用才能匿名取得更新清单和产物；应用内保留下载失败的明确提示，不内置 GitHub 访问令牌。私有期间 Actions 与 Releases 仍受仓库权限控制，macOS runner 使用账号套餐额度。

本地可以只验证发布逻辑和源码版本：

```sh
node --test .github/scripts/desktop-release.test.mjs
node .github/scripts/desktop-release.mjs check
```

`prepare` 和 `publish` 会写 GitHub，供 main 的发布工作流调用。本地验证使用隔离的 HTTP GitHub 替身，不访问真实仓库或发布真实版本。

### 首次线上验收

推送后在 `Desktop release` 检查 prepare、build、publish 三阶段，确认 tag 指向触发提交，安装包版本与 tag 一致，双架构和签名检查通过，Release 含完整的五项产物，并按 `SHA256SUMS` 验证下载文件。在真实 Mac 上验证首次安装和打开；公开后再从前一个安装版本完成检查、下载校验、安装和重启，核对运行任务阻止安装、结束后可重试，以及重启后的版本。私有期间额外核对下载者权限。

失败时查看对应步骤的 HTTP 状态、版本校验或构建错误。修复后重跑失败任务；已发布版本需要修复时，将修复或 revert 合入 main，自动生成后续版本。发布结果异常时可在 GitHub 暂停 `Desktop release`，完成核对后恢复。首次线上执行和首次安装验收由维护者完成。

## relay 自动发布与 latest 晋升

relay 发布全流程按 `relay-release` 串行排队。`prepare` 在 `relay-v` 命名空间按北京时间分配日期版本并预留 tag；同提交重跑复用版本。Cargo.toml 和 Cargo.lock 在镜像构建工作区同步为日期版本，服务端二进制、健康检查和 hello-ack 因此返回同一个产品版本。

已发布版本通过 GHCR 查询确认 OCI 版本标签、源码 SHA、双架构及 digest；它们一致时重跑复用该镜像，只继续 latest 晋升。构建失败保留预留号，旧提交被新版本覆盖时跳过；旧任务只重跑失败步骤时继续用原版本，并通过 latest 比较保持单调。

版本与 SHA 标签推送成功后，独立任务按 `relay-latest` 组串行排队，保留最多 100 个等待任务。构建步骤只写版本与 SHA 标签；晋升任务读取 GHCR 当前 `latest` 镜像配置中的版本标签，按三个数字版本段比较：

- 正式 `relay-vX.Y.Z` 且高于现有版本时，将已发布的双架构 digest 晋升到 `latest`。
- 首次发布的 `latest` 返回 404 时，允许正式版本建立该标签。
- 旧版本、同版本重跑保留现有 latest；手动执行也只接受 main，沿用该提交的预留版本和已发布镜像。
- GHCR 准入、网络、服务错误或现有版本标签无法识别时，结束晋升并报告原因，保留当前 `latest`。

串行队列覆盖并发更新；版本比较覆盖旧版本重跑和构建完成顺序变化。`relay-release.mjs prepare` 会预留 Git tag，`stamp` 只写当前工作区版本，只有显式 `--publish` 才执行 latest 晋升；普通本地验证只运行其隔离测试。

“设置 → 远程 → 中转服务”中的版本来自当前 WebSocket 握手，连接后显示 relay 独立产品版本，旧 relay 省略字段时明确说明，断开后清除。版本只用于展示，协议兼容继续按协议号判断。

## 验证边界

本地可以覆盖项目逻辑、页面行为、工作流静态语法和本机架构容器。`--image` 在 Apple Silicon 上构建 arm64，在 Ubuntu amd64 runner 上构建 amd64；另一个架构由发布工作流构建。GHCR 权限、真实标签推送、Pages 配置、线上域名、真机安装和公网 WSS 需分别在线上或真机验收。测试使用 fake-host，真实桌面互通另运行 `relay/` 的 `pnpm interop`。
