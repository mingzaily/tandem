# 2026-11-11 桌面、relay 自动发布与主动更新

桌面、官网 / PWA 和 relay 按实际产物依赖分别触发。桌面和 relay 的相关改动进入 main 后自动发布，都使用北京时间的 `major.minor.YYYYMMDDNN`；两者通过 `v` / `relay-v` 命名空间独立计数，版本无需一致。官网和 PWA 跟随部署提交 SHA。路径规则见 [CI 与本地验证](../dev-rules/ci-validation.md)。

桌面左下角版本入口提供检查、下载校验、安装并重启三个阶段，运行中的任务、标题操作及 Agent 安装登录阻止安装。远程设置的中转版本来自当前握手，不轮询；断开清除读数，旧中转未返回版本时明确说明。

## 审查结果

业务逻辑审查覆盖路径触发、独立日期序号、同提交重跑、草稿中断、旧版本与 Latest 保护、镜像 digest 和源码 / 双架构校验、固定更新源、签名与版本绑定，以及运行任务和安装互斥。

代码设计审查覆盖共用日期算法、构建和发布权限分离、复用桌面 PR / 发布检查、后端持有 URL 和下载字节、页面单一状态控制器、连接状态中命名的版本字段，以及复用菜单和设置行样式。启动没有新增更新检查请求；CSP 和页面插件权限保持原样。

## 本地验证

- 发布自动化：84 项通过，包含真实 HTTP 替身和 CLI 执行、符号链接路径、独立日期命名空间、跨日、重跑、更新清单、校验值、草稿重试、已有镜像复用和 Latest 保护。
- 路径：25 类文件、桌面 PR / 发布路径一致性、分支与 tag 边界、混合改动全部通过，见 [workflow-routing.json](assets/desktop-updater-2026-11-11/workflow-routing.json)。
- 工作流：actionlint 通过；仅沿用仓库对 actionlint 1.7.12 尚未识别的 `concurrency.queue` 的精确例外。
- 桌面前端：类型检查通过，50 个测试文件、315 项通过。更新覆盖主动触发、重复操作、晚到进度、签名失败和任务忙碌后重试；中转版本覆盖在线、离线和旧服务端缺失字段。
- 桌面后端：260 项通过，1 项原有忽略；clippy 全目标通过。官方 updater 使用独立测试公钥验证真实签名样本，并拒绝内容篡改和版本冒用；连接状态测试验证在线保留版本、断开及重连清除。
- relay：13 项 Rust 测试、22 项 WebSocket 集成测试通过，类型检查和 clippy 通过。真实子进程握手与健康检查核对产品版本，通信协议仍为 v1。
- 官网 / PWA：PWA 71 项测试、官网 2 项测试，以及根路径和 Pages 路径下各 4 组宽窄浅深色浏览器流程通过；托管、安装范围和离线外壳通过。
- CLI 配置：四份用户配置哈希保持原样。

共享浏览器验收发现原有单选题脚本仍等待提交按钮；按当前“选中即提交”的行为改为等待问题卡结束，并保留输入草稿断言。容器验收发现 relay 自带健康命令对 JSON 做固定字符串匹配；先用真实 TCP 响应测试复现，再改为解析 `ok` 和协议号，允许可选产品版本字段，补齐失败状态和格式边界测试。

## 通用安装包与签名更新包

在独立源码副本中使用 CI 的正式优化配置及真实更新签名密钥构建，生成：

| 产物 | 大小 |
|---|---|
| Apple Silicon / Intel 通用 `.dmg` | 6,999,047 bytes（约 6.67 MiB） |
| `Tandem.app.tar.gz` 更新包 | 7,114,605 bytes（约 6.79 MiB） |

两处 plist 版本均为 `0.1.2026111101`，实际 Mach-O 包含 arm64 / x86_64，ad hoc 签名和 DMG 校验通过；更新签名绑定该版本。使用应用配置公钥验证实际更新归档成功，篡改一个字节后拒绝。当前 Xcode 的 `lipo -verify_arch` 参数调用失败，CI 改为 `lipo -archs` 后分别断言两种架构。

证据：[产物验收](assets/desktop-updater-2026-11-11/updater-artifacts.txt)、[实际更新包签名验证](assets/desktop-updater-2026-11-11/update-signature-verification.txt)。本次只验证隔离产物，没有替换正在使用的应用。

## 界面证据

真实组件、CSS 和浏览器中的 IPC 替身覆盖下列状态：

- [发现更新（浅色）](assets/desktop-updater-2026-11-11/available-light.png)
- [安装就绪（浅色）](assets/desktop-updater-2026-11-11/ready-light.png)
- [安装就绪（深色）](assets/desktop-updater-2026-11-11/ready-dark.png)
- [任务忙碌后重试（深色）](assets/desktop-updater-2026-11-11/busy-dark.png)
- [中转版本（浅色）](assets/desktop-updater-2026-11-11/relay-version-light.png)
- [中转版本（深色）](assets/desktop-updater-2026-11-11/relay-version-dark.png)

最终 arm64 容器构建与完整启动验收通过：非 root、只读根文件系统、内置健康检查、PWA 页面与 WebSocket 配对、令牌权限及持久化、容器重启和 SIGTERM 退出全部通过，临时容器与数据卷已清理。Docker 本机代理曾导致 Corepack 下载超时，本次构建单独清空代理参数后通过，仓库和 CI 沿用原构建命令。验证摘要见 [container-validation.txt](assets/desktop-updater-2026-11-11/container-validation.txt)。

远端 Actions 首次执行、GHCR 双架构上传与权限、仓库公开后的匿名下载，以及真实旧版到新版的替换重启，仍需首次发布后验收。

更新私钥保存在本机受限目录和仓库 Actions Secret；源码只包含公钥，签名测试使用已经丢弃私钥的独立样本。没有提交、推送、上传产物或创建 Release。
