# 仓库地图

> **状态**：权威
> **读取时机**：找代码入口，或新增模块决定放哪里之前

## 桌面端 `desktop/`

| 路径 | 职责 |
|---|---|
| `src/App.tsx` | 应用状态：任务列表、当前选择、运行中的轮次、通知 |
| `src/components/Sidebar.tsx` | 侧边栏：新建、搜索、项目分组和排序、任务行 |
| `src/components/MessageStream.tsx` | 对话区：虚拟列表、工作组、工具行、思考行。按需加载 |
| `src/components/Markdown.tsx` | Markdown 和代码高亮。随对话区按需加载 |
| `src/components/Composer.tsx` | 输入框、附件、发送和停止 |
| `src/lib/composerFocus.ts` | 输入空白与控件的焦点边界、发送后的焦点归属 |
| `src/components/PendingQueuePanel.tsx` | 合并到输入卡片的待发送列表、常驻行操作、暂停与继续、指针和键盘排序 |
| `src/components/FileChangeSummary.tsx`、`src/lib/fileChanges.ts` | 各轮成功文件编辑的去重与累计行数；随结果保留的内嵌卡片、折叠与虚拟文件清单，随消息流按需加载 |
| `src/components/ConversationLayout.tsx` | 消息流与底部输入区的叠放、32px 渐隐和动态底部留白 |
| `src/components/ComposerControls.tsx` | 模型入口、权限、项目选择、底部的用量和上下文圆环 |
| `src/components/ModelPickerPanel.tsx`、`ModelConfigFlyout.tsx` | 按需加载的模型列表与独立强度配置，预览后将模型和强度一起应用 |
| `src/components/ComposerMenu.tsx`、`src/lib/useAnchoredPosition.ts` | 输入区弹层挂到页面顶层，按触发器位置跟随滚动与窗口变化 |
| `src/components/EffortSlider.tsx`、`src/lib/modelEffort.ts` | 原生模型推理档位、默认值、颜色和滑块交互 |
| `src/lib/modelRows.ts`、`modelFlyoutPosition.ts` | CLI 默认模型对应关系、模型与强度组合，以及配置浮层的行锚点和视口定位 |
| `src/components/RunningStatus.tsx` | 运行状态行和生成速度卡片 |
| `src/components/QuestionPrompt.tsx`、`PermissionPrompt.tsx` | 提问和确认卡片 |
| `src/components/SettingsView.tsx` | 设置页，含 Agent、项目和远程 |
| `src/components/TrayPanel.tsx` | 菜单栏面板，是单独的窗口 |
| `src/lib/api.ts` | Tauri 命令和事件的类型与调用，页面只从这里访问后端 |
| `src/lib/items.ts` | 消息转界面行、实时事件合并、工作组折叠规则 |
| `src/lib/tools.ts` | 工具行的动词和参数、摘要、时间格式 |
| `src/lib/tokenRate.ts` | 生成速度的采样，不含工具执行和等待的时间 |
| `src/lib/i18n.ts` | 文案，只有 `zh-CN` 和 `en` |
| `src-tauri/src/commands.rs` | 暴露给页面的 Tauri 命令，各 CLI 的统一入口 |
| `src-tauri/src/sessions.rs`、`runner.rs` | Claude：读会话文件；启动 `claude`，解析流式输出，停止任务 |
| `src-tauri/src/codex.rs` | Codex：通过 `codex app-server` 读取和运行 |
| `src-tauri/src/pi.rs` | Pi：读会话文件，通过 `pi --mode rpc` 运行 |
| `src-tauri/src/titles.rs` | 独立生成任务标题，通过 CLI 元数据接口写回原生标题 |
| `src-tauri/src/writers.rs` | 查任务是否开在别的进程里、是否正在运行 |
| `src-tauri/src/storage/` | `~/.tandem/` 配置与界面状态：TOML 注释保留、原子写入、窗口快照、文件观察、独占迁移 |
| `src-tauri/src/remote/` | 手机访问：加密（`crypto`）、连接中转和会话（`link`）、手机能做的操作（`ops`）、配置（`store`） |
| `src-tauri/src/agents.rs`、`cli_info.rs` | CLI 的状态、安装和登录；模型和用量 |
| `src-tauri/src/attachments.rs`、`conversations.rs` | 附件；对话分组和项目发现 |
| `src-tauri/src/tray.rs` | 菜单栏图标、面板和通知 |
| `src-tauri/src/login_env.rs` | 读取登录 shell 的环境变量 |
| `src-tauri/src/harness.rs` | 仅调试版：用脚本驱动页面 |
| `design/tokens/` | 设计 token |

## 其他目录

- `pwa/`、`relay/`：见各自的 README，接口见 [中转协议](../relay-protocol.md)。
- `site/`：文档站和产品官网，还没开始。
- `docs/`：见 [文档索引](../README.md)。
- `docs/brand/`：应用图标和标记的源文件。
- `docs/reference/`：历史文档和本地参考仓库。

## 参考仓库

`docs/reference/repos/` 放 Cindy 和 ccgui 的代码，供实现时查阅，已被 Git 忽略，不会上传。说明见 [参考资料](../reference/README.md)。
