# 文档索引

内部的规范和工程管理文档都放在这里，结构和写法仿照 Cindy，内容按 Tandem 的实际情况重写。面向用户的文档放在 `site/`，不放这里。

**状态含义**：`权威` = 对相关改动有约束力；`参考` = 背景资料，不构成约束。

| 文档 | 状态 | 什么时候读 |
|---|---|---|
| [product-rules/core-product-principles.md](product-rules/core-product-principles.md) | 权威 | 新增或调整任何功能 |
| [product-rules/task-and-conversation-naming.md](product-rules/task-and-conversation-naming.md) | 权威 | 写涉及任务、对话、消息的文案 |
| [design-rules/README.md](design-rules/README.md) | 权威 | 改界面、样式、动效、文案 |
| [dev-rules/repo-map.md](dev-rules/repo-map.md) | 权威 | 找代码入口 |
| [dev-rules/environment-setup.md](dev-rules/environment-setup.md) | 权威 | 首次搭环境 |
| [dev-rules/desktop-development.md](dev-rules/desktop-development.md) | 权威 | 启动、验证、驱动桌面端 |
| [dev-rules/engineering-conventions.md](dev-rules/engineering-conventions.md) | 权威 | 写前端或 Rust 代码和测试 |
| [dev-rules/architecture-invariants.md](dev-rules/architecture-invariants.md) | 权威 | 改模块依赖或数据流 |
| [dev-rules/security-and-process-boundaries.md](dev-rules/security-and-process-boundaries.md) | 权威 | 新增 Tauri 命令、权限、外部进程 |
| [dev-rules/credentials-and-local-storage.md](dev-rules/credentials-and-local-storage.md) | 权威 | 处理凭证或写文件 |
| [dev-rules/agent-configuration-inventory.md](dev-rules/agent-configuration-inventory.md) | 权威 | 修改 Agent 设置里的 MCP、Skills 或配置来源读取 |
| [dev-rules/native-sessions.md](dev-rules/native-sessions.md) | 权威 | 读写任务数据、接入新 CLI |
| [dev-rules/development-workflow.md](dev-rules/development-workflow.md) | 权威 | 分批、提交、Review、汇报 |
| [dev-rules/ci-validation.md](dev-rules/ci-validation.md) | 权威 | 本地复现 CI、检查工作流、验证容器及理解发布门禁 |
| [relay-protocol.md](relay-protocol.md) | 权威 | 改桌面端远程、relay 或 PWA 之间的接口 |
| [relay-test-vectors.json](relay-test-vectors.json) | 权威 | 改配对或会话的加密实现，桌面端和 PWA 都用它测试 |
| [roadmap.md](roadmap.md) | 权威 | 决定下一步做什么 |
| [decisions.md](decisions.md) | 权威 | 了解已定和待定的决策 |
| [reviews/2026-11-05-desktop-ui-details.md](reviews/2026-11-05-desktop-ui-details.md) | 参考 | 复审 11 月 5 日下午至晚间的桌面样式、交互、实现细节与验证范围 |
| [measurements/](measurements/2026-11-04-startup-and-memory.md) | 参考 | 比较启动和内存 |
| [measurements/2026-11-11-desktop-updater.md](measurements/2026-11-11-desktop-updater.md) | 参考 | 查看桌面自动发布、主动更新、签名与版本绑定、任务保护和界面证据 |
| [measurements/2026-11-12-about-updates.md](measurements/2026-11-12-about-updates.md) | 参考 | 查看关于页更新入口、自动更新与检查间隔、后台状态恢复和验证边界 |
| [measurements/2026-11-06-tray-scroll.md](measurements/2026-11-06-tray-scroll.md) | 参考 | 查看菜单栏长列表、窗口高度、滚动终点和固定底栏的回归验证 |
| [measurements/2026-11-05-message-queue.md](measurements/2026-11-05-message-queue.md) | 参考 | 查看消息队列验收、测试范围和性能抽样 |
| [measurements/2026-11-05-task-titles.md](measurements/2026-11-05-task-titles.md) | 参考 | 查看标题生成、原生保存和 Codex 附件显示的验收范围 |
| [measurements/2026-11-05-model-controls.md](measurements/2026-11-05-model-controls.md) | 参考 | 查看三种 CLI 的模型与推理档位、弹层裁切修复和验证范围 |
| [measurements/2026-11-05-composer-overlay.md](measurements/2026-11-05-composer-overlay.md) | 参考 | 查看消息区与输入区渐隐、动态留白和滚动验证 |
| [measurements/2026-11-05-model-defaults.md](measurements/2026-11-05-model-defaults.md) | 参考 | 查看模型菜单方向、CLI 默认模型标记和验证范围 |
| [measurements/2026-11-05-queue-presentation.md](measurements/2026-11-05-queue-presentation.md) | 参考 | 查看队列合并卡片、中断颜色、文件编辑摘要与页面验收 |
| [measurements/2026-11-05-composer-focus.md](measurements/2026-11-05-composer-focus.md) | 参考 | 查看输入光标、发送后焦点恢复与两种输入框高度的验证 |
| [measurements/2026-11-05-model-config-flyout.md](measurements/2026-11-05-model-config-flyout.md) | 参考 | 查看模型主列表高度、独立强度配置、键盘操作和浅深色验收 |
| [measurements/2026-11-05-composer-coordination.md](measurements/2026-11-05-composer-coordination.md) | 参考 | 查看队列、输入区与底栏对齐，编辑态和入队反馈的实际验收 |
| [measurements/2026-11-05-settings-actions.md](measurements/2026-11-05-settings-actions.md) | 参考 | 查看设置页操作布局、表单提交与写盘失败重试的验证 |
| [measurements/2026-11-06-file-change-card.md](measurements/2026-11-06-file-change-card.md) | 参考 | 查看按 Cindy 收拢的文件变更卡片、居中修正、历史保留与验证范围 |
| [measurements/2026-11-06-composer-actions.md](measurements/2026-11-06-composer-actions.md) | 参考 | 查看文件标题区压紧、移除入队小字与提交图标的验证 |
| [measurements/2026-11-06-queue-cindy.md](measurements/2026-11-06-queue-cindy.md) | 参考 | 查看队列恢复 Cindy 布局、密度、底栏和行操作层级的验收 |
| [measurements/2026-11-06-desktop-review-fixes.md](measurements/2026-11-06-desktop-review-fixes.md) | 参考 | 查看 review 后队列、顶部状态行、图标、指针和即时模型配置的最新验收 |
| [measurements/2026-11-06-remote-connection-capsule.md](measurements/2026-11-06-remote-connection-capsule.md) | 参考 | 查看手机连接胶囊、双设备撤销、失败重试与原生截图的验收 |
| [measurements/2026-11-06-pages-app.md](measurements/2026-11-06-pages-app.md) | 参考 | 查看顶层独立 PWA 的官网交付、安装身份、缓存范围与截图验收 |
| [measurements/2026-11-06-ci-automation.md](measurements/2026-11-06-ci-automation.md) | 参考 | 查看 CI 四项补齐、本地共享入口、版本晋升和容器验收范围 |
| [measurements/2026-11-06-queue-reliability.md](measurements/2026-11-06-queue-reliability.md) | 参考 | 查看坏队列隔离、空队列暂停清理、CLI 接收回执与崩溃恢复验收 |
| [measurements/2026-11-06-final-review.md](measurements/2026-11-06-final-review.md) | 参考 | 查看最终 review 清单、单次写入者授权、确认重试、模型按钮、图片存储与 release 性能复测 |
| [measurements/2026-11-06-tool-status.md](measurements/2026-11-06-tool-status.md) | 参考 | 查看运行行工具名称、MCP 可读标签、参数悬停与展开、浅深色和窄窗口验收 |
| [measurements/2026-11-06-unified-storage.md](measurements/2026-11-06-unified-storage.md) | 参考 | 查看统一数据目录、TOML 手改、双窗口配置同步、一次性迁移与性能验收 |
| [measurements/2026-11-07-storage-final-review.md](measurements/2026-11-07-storage-final-review.md) | 参考 | 查看旧导入删除、坏状态隔离、未知字段、双实例写锁、旧数据清理、桌面 CI 与最终复审 |
| [measurements/2026-11-08-session-sidebar-settings.md](measurements/2026-11-08-session-sidebar-settings.md) | 参考 | 查看原生图片、Codex 写锁、本地链接、工作组、侧栏与 Agent 资源清单的源码对照、截图和验收 |
| [reference/](reference/README.md) | 参考 | 查 loom 的历史文档，以及本地的 Cindy、ccgui 代码 |

## 收录规则

- 产品规则写用户应该得到什么结果；开发规则写代码怎样实现和验证；设计规则写界面长什么样。不要混写。
- 每条规则写清触发条件、要做什么、不能做什么、怎么验证。
- 能用测试或类型检查保证的规则，同时落实到自动检查。
- 还没实现的内容写进路线图，不写成现状。
