# 瘦身计划：按批删除 Cindy 功能

> 配合根目录 `AGENTS.md` 的「删除规则」使用。每批单独提交，**按顺序执行**：各批都会改到
> `bootstrap-electron.ts`、`maker-ipc/register.ts`、`maker-host/index.ts`、设置页等公共文件，
> 并行做会互相冲突。
>
> 表里的路径是起点，不是穷举：用 `grep` 反查所有引用方，连同测试、i18n 键、设置入口、
> IPC 通道和 `packages/device-link/src/allowlist.ts` 条目一起处理。拿不准的写进报告的「待确认」，不要删。

基线（瘦身前，登录页）：12 个 Electron 进程，RSS 合计约 707 MB。

---

## B1 跨账号与分享

loom 只有「自己的设备之间」的远程，不需要把任务、供应商、聊天分享给别的账号。

| 删除 | 起点 |
| --- | --- |
| 共享任务邀请（跨账号共享任务、访客） | `main/session-share/`、`main/device-link/sharedTaskApi.ts` 及共享任务相关 host 逻辑、`renderer/features/share/`、`renderer/features/device-link/SharedTaskDialog*`、`packages/device-link/src/sharedTask*.ts`、`apps/mobile/app/shared-session.tsx` |
| 供应商分享 | `main/device-link/providerShareApi.ts`、`renderer/features/provider-share/`、`packages/device-link/src/providerShare*.ts`、`apps/mobile/src/device-link/providerShareLinkIntent.ts` |
| 供应商导入链接（`loom://provider/import`） | `main/provider-import/`、`main/deepLink.ts` 中 provider-import 分支 |
| 聊天邀请（`chat-invite`） | `renderer/features/bots/ChatInvite*`、`main/deepLink.ts` 中 chat-invite 分支、`packages/device-link/src/chatInvitation*` |

保留：device-link 核心、`selfHostedRelay*`、设备配对与同账号远控（下一阶段改成无账号的扫码配对）。

注意：`selfHostedRelay.ts` 引用了 `SharedTaskInvitationApp` 类型（`cindy` 系 app 标识），删共享任务时把这个类型移到 relay 自己的定义里，不要删 relay。

---

## B2 IM、伙伴、自动化

| 删除 | 起点 |
| --- | --- |
| IM 渠道（飞书、Discord、Telegram、钉钉、微信、企业微信、Slack） | `main/im/`、`main/wecomGroupNotification.ts`、`renderer/components/feishuBot/`、设置页 `ImBotSection` 系列；包 `lizi-im`、`wechat-ilink`、`slack-hook-protocol` |
| 官方 bot 接入 | `main/hook-control/`、设置页 `HookConnectionsSection` 系列 |
| 伙伴（智能体 / Bot）、云端伙伴 | `main/bot-autonomy/`、`main/bot-import/`、`main/botTaskReplyResults.ts`、`main/companion-cloud/`、`main/contacts-sync/`、`main/maker-ipc/bot*`、`renderer/features/bots/`、`localDb` 里 bots 的 IPC（表保留） |
| 定时任务、例行任务 | `main/scheduler-host/`、`main/routines/`、`renderer/features/scheduler/`；包 `maker-scheduler`（先确认 `lizi-mcps` 的引用，`lizi-mcps` 在 B4 删除，可以一起处理） |

保留并「待确认」：`orca-workflow` 与 Orca 协同（loom 第一期要做自己的多 agent 协作，可能复用其界面，见 architecture §7）、`agent-island`（灵动岛）、`goal-host`、`learn-host`。

---

## B3 模型网关、账号、计费

违反 P3 的部分，优先级最高。**Claude Code 目前被 `anthropic-compat-proxy` 接管了 `ANTHROPIC_BASE_URL`**，删完之后三个引擎必须直接使用用户自己的登录态和配置。

| 删除 | 起点 |
| --- | --- |
| 协议桥与代理 | 包 `anthropic-compat-proxy`、`anthropic-responses-bridge`、`responses-anthropic-bridge`、`responses-chat-bridge`、`model-compat`；`main/maker-host/` 里的 proxy host、`runtime-configs.ts` 的 endpoint 注入（`claudeUpstreamEndpoint` 等） |
| 供应商与 BYOM、本地模型、供应商组 | `main/model-access/`、`main/provider-group/`、`main/local-model-runtime/`、`main/utility-model/`、`main/vision-bridge/`、`main/cindyAiProviderName.ts`、`renderer/features/provider-group/`、设置页 `ProvidersSection`、`AddProviderWizard` 等 |
| 计费、云账号、云端点 | `main/billing/`、`renderer/features/billing/`、`main/auth*.ts`、`main/account*.ts`、`main/serverApiClient.ts`、`main/clientEndpointsService.ts`、`main/endpointManifest*.ts`、`main/canaryFlag*.ts`、`main/heartbeatService.ts`、`main/xdOrgBetaDefault.ts`、`renderer/components/login/`、`renderer/components/auth/`；包 `heartbeat-client` |

做法：
- 应用固定运行在「本地模式」（Cindy 已有的 account-free 模式，`enterLocalMode`），去掉登录页和账号切换；数据 owner 固定为本地 owner。
- 各引擎环境变量只透传用户自己的配置（`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`PI_CODING_AGENT_DIR` 等），不再注入任何 endpoint、key、token。
- 模型列表来自各 CLI 自己（Codex `model/list`、Pi `get_available_models`、Claude SDK），不再来自 Cindy 的目录。

保留：包 `model-providers` 与 `auth-client`（`maker-core` 和手机端依赖），只去掉桌面端的网关和账号用法；手机端在远程阶段处理。

---

## B4 其他非核心功能

| 删除 | 起点 |
| --- | --- |
| 语音 | `main/voice-input/`、`main/voice-conversation/`、设置页语音相关（包 `voice-input-core` 保留给手机端） |
| 远程桌面、自动操作、外设 | `main/remote-desktop/`、`main/remote-desktop-viewer/`、`main/computer-permission-guide/`、`main/android-automation-settings-store.ts`、`main/input-devices/`、`main/xbox-gamepad/`、`main/nativeTrackpad.ts`、`renderer/features/remote-desktop/`、`renderer/features/remote-device/` 中远程桌面部分 |
| 浏览器控制 | `main/rsb-browser-bridge/`、`main/browser-recipes/`、`main/mcp-integrations/` 中 browser 部分；包 `browser-control-runtime` |
| 截图、壁纸 | `main/region-screenshot/`、`renderer/features/region-screenshot/`、`main/custom-wallpaper*.ts`、`main/wallpaper-video.ts` |
| Cindy Make、自动更新、日志上传、统计 | `main/cindy-make/`、`renderer/components/cindy-make/`、`main/update*.ts`、`main/agent-app-update/`、`renderer/components/UpdateNoticeDialog.tsx`、`main/log-upload/`、`main/analytics*.ts` |
| 帮助助手、记忆、向量检索、项目知识 | `main/cindy-brain/`、`main/embedders/`、`main/embedding-host/`、`renderer/features/learn/`（确认后）；包 `embedding-client`、`project-context` |
| 内置 MCP 集合、插件市场 | 包 `lizi-mcps`、`opencli-vendor`、`github-client`、`gitlab-client`（先确认 `git-review` 等是否引用）；`main/plugin-market/`、`main/plugin-publisher/`、`renderer/features/skillhub/`、`main/skillhub/`（Skills 的「按 CLI 展开」以后重做） |
| 其他 | `main/doc-tools/`、`main/github-issue/`、`renderer/features/issue-tracker/`、`main/chatgpt-app.ts`、`main/worklouder-codex/` |
| 任务导入 | 设置页 `SessionImportSection`、`main/task-migration/` 中导入部分。原生会话就是事实源，不需要把历史导入 loom 的数据库 |
| 个性化 | 设置页 `PersonalizationSettings`（自定义指令、记忆）及 `maker-memory-host`。各 CLI 有自己的 `CLAUDE.md`、`AGENTS.md`，loom 不另加一层 |
| 帮助 | 设置页 `HelpSection`、`TipsSection`、`maker-ipc/helpKnowledge*` |
| 本机应用连接 | `main/local-agent/`、设置页 `LocalAgentSection`、`remote-agent/host` 中给本机应用授权的部分 |
| 关于页里的 Cindy 内容 | 服务条款、隐私协议、「和 Cindy 联系」（Discord、X、小红书）。三个 CLI 的版本号移到 B5 的「Agent」页 |
| 首页建议 | `HomeSuggestionList` 里「盯网页」「测网速」「订阅支出」「邮件」这类通用助手建议，换成写代码相关的，或者整块去掉 |
| 空目录 | 前几批删除后留下的空目录（`main/im/`、`packages/lizi-im/` 等）一起清掉 |

保留：插件框架本体与 `cindy-tools`、`menubar`、文件浏览、终端、git 面板。

远程连接页：「我的设备」和「中转服务」依赖 Cindy 账号和官方中转，在 loom 里目前用不了。**代码保留**，本批只把这两块的设置入口隐藏；「SSH 远程主机」不依赖账号，照常显示。B7 恢复 Cindy 登录后再显示。

---

## B5 品牌、界面与 Agent 页

1. **品牌图片**：源文件在 `docs/loom/brand/`：`loom-icon.svg`（带底色的应用图标）和 `loom-mark.svg`（单色透明底标志）。wordmark 用小写「loom」，字体用仓库里已有的 Barlow Condensed SemiBold（`native/menubar/`，OFL 授权）。由这些源文件生成 PNG 和 icns，替换应用图标（`resources/icon*.png`、`icon.icns`、`icon-dock.png`）、菜单栏 wordmark（`native/menubar/wordmark-*.png`）、首页 lockup、主题自带的 logo（`themes/builtin/cindy-*.ts` 引用的图片）、账号头像。Cindy 的角色形象（头像、分享插画、灵动岛吉祥物）全部去掉，不再使用。
2. **界面文案**：界面上的「Cindy」改成「loom」（五种语言）。已被删除功能的残留文案键直接删除，不要改名。
3. **模型选择器还原**：B3 把 Cindy 的统一模型面板（`UnifiedModelPanel`、`UnifiedModelRail`、`UnifiedModelRow`、`ModelConfigFlyout`）删掉，换成了一个简单的标签页弹层，样式和交互都变了。按快照提交 `fbb1010f` 还原原来的组件、样式和交互，只去掉供应商、价格、分享、BYOM 相关的逻辑。左侧栏改成：最近、收藏、全部、Claude Code、Codex、Pi（用引擎的品牌图标）。模型数据仍来自各 CLI。
4. **设置里的「Agent」页**：只读，不提供任何配置项（配置由用户自己用 CLI 或 cc-switch 这类工具管理）。三张卡片：
   - 共同部分：是否已安装、可执行文件路径、版本号（从关于页移过来）。
   - **Claude Code**：登录状态和账号（`claude auth status --json`）；「登录」按钮在 loom 内置终端里运行 `claude auth login`；额度显示 5 小时和 7 天窗口的已用比例和重置时间。额度来源：SDK 的 `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })`，会话进行中再用 `rate_limit_event` 更新。这个 API 标注为实验性，调用集中在一个函数里；拿不到时（例如使用 API key）不显示额度。
   - **Codex**：登录状态（app-server `account/read`）；「登录」按钮在内置终端里运行 `codex login`；额度来自 app-server `account/rateLimits/read`，会话中用 `account/rateLimits/updated` 更新，显示主窗口（5 小时）和次窗口（每周）。
   - **Pi**：只显示安装信息和版本，不显示登录状态和额度（Pi 的供应商由用户自己配置）。
   - 额度只在打开该页、打开模型选择器时读取，不做后台轮询。loom 不读取、不保存任何凭据，全部通过 CLI 或官方 API 获取。
   - 模型选择器左侧栏的引擎格可以显示同一份额度（原来的左侧栏本来就显示每周额度）。

---

## B5 之后的直接修改（2026-10-30，不经 Codex）

- 首页 lockup 默认只显示 loom wordmark；只有本地主题自带头像时才在前面显示圆形图标。
- 内置主题「loom」（原 Cindy 主题）保留，只是名字叫 loom；不要删。
- 删除 LSP（`cindy-tools/host/lsp`、`lsp-mode-store`、设置项、IPC），以及因此变空的「实验性功能」区块。
- Pi 扩展从「通用」移到「Agent」页 Pi 卡片，只读显示 `pi list` 的用户级扩展；loom 不再提供安装、启用、卸载。`pi-package-store` 等后端暂留（Pi 运行时仍在用），随「Pi 回到原生目录」一起删除。
- Agent 页：去掉页面标题和描述（与其他设置页一致）；结果缓存在内存里，再次打开不重新闪「正在读取」；已登录时不显示「登录」按钮。
- 模型选择器左侧栏：额度条只在选中的引擎上显示。
- 界面语言只保留简体中文和英文（desktop、mobile、Windows 安装器、术语表）。中文系统语言（含繁体）一律用简体中文，其余用英文。
- 补回被前几批删掉、但代码仍在使用的文案键（帮助菜单「打开日志文件夹」等）；Debug 日志说明改短。
- 菜单栏：状态图标改为模板图，跟随菜单栏深浅自动反色；「打开 loom」按钮里的标志改用按钮前景色。

复查 B4/B5 时发现的问题：
- 引用已删除模块的孤儿测试没被 `test:unit:related` 选中（例如读取 `XUsageGuide.tsx` 的测试）。
- HEAD 上 mobile 全量单测有 20 个失败（11 个文件），都与已删除的功能有关，B6 一并处理。
- 开发模式下 macOS 菜单栏第一项显示「Electron」，是 dev 用的 Electron.app 包名，打包后是 loom，不用改。
- loom 仍在每轮对话里给 CLI 追加 Cindy 的系统提示（`*-system-prompt.md`、`uiLanguageErrorNote` 等），会让 GUI 会话和终端会话行为不一致。列为「待确认」，在会话数据源阶段一起评估。

---

## B5b 界面还原与整理

原则：**样式和交互照抄 Cindy**（快照 `fbb1010f`，用 `git show fbb1010f:<路径>` 对照），只把数据源换成各 CLI。改完用 `pnpm ui:check` 截图，和 Cindy 原组件的截图对比。

1. **Agent 页改成 Cindy「模型供应商」页的二级布局**：左侧列表（Claude Code、Codex、Pi），右侧详情（Cindy 的 `DetailHeader` 结构）。详情内容沿用现在的只读信息：路径、版本、登录状态（未登录才显示「登录」）、额度；Pi 显示版本和 `pi list` 扩展。额度区域还原 Cindy 的订阅额度卡（`components/status/QuotaHoverCard.tsx`、`usageCardModel.ts`、`QuotaBar.tsx`），数据来自现在的 `agent-info` 服务（Claude 5 小时 / 7 天，Codex 主窗口 / 次窗口）。删除 Cindy 卡片里与计费、余额、供应商组相关的分支。
2. **模型选择器左侧栏**：悬停提示还原 Cindy 的多行内容（名称、剩余额度、重置倒计时，见快照 `UnifiedModelRail.tsx` 的 `RailButtonView`）。
3. **菜单栏额度**：还原 Cindy 菜单栏弹窗里的额度展示（快照 `native/menubar/macos-menubar-helper.swift` 的 `MBUsage`、额度行），数据换成 Claude Code、Codex 的 5 小时 / 每周额度；Cindy 的花费账本、币种、使用量图表不恢复。`headlinePrimary` 用额度摘要。
4. **删除「工具」设置页和自定义 MCP**：MCP 属于各 CLI 自己的配置，loom 不再维护一层。删除 `BuiltinToolsSection`、`McpServersSection`、`McpServerDialog`、`custom-mcp-store`、`custom-mcp-registry`、`custom-mcp-provider`、`mcpHandlers` 里自定义 MCP 的部分、对应 preload/IPC/secret 存储与测试。协同模式（Orca）保持默认开启，不再提供开关（Orca 本身仍是「待确认」）。
5. **侧边栏去掉「插件」入口**：插件只在「设置 → 插件」里管理；带主视图的插件仍可自己出现在侧边栏。`/plugins` 主视图若无其他入口一并删除，深链改到设置页。
6. **存储空间页**：对照快照还原 Cindy 的布局（B4 删功能后留下了卡片套卡片、提示条样式不一致的问题），只保留仍存在的项目。
7. **新建项目**：参考 `reference/ccgui`（侧边栏项目区标题旁的「+」，用文件夹选择器添加，项目列表只存路径这类 UI 元数据）。在侧边栏项目区加「添加项目」入口，复用现有的「选择其他项目文件夹」流程；项目为空时也要显示这个入口。项目下的会话列表等「会话数据源改为原生读取」后再接。

### B5b 完成情况（2026-10-30，Claude 直接完成）

| 项 | 提交 | 说明 |
| --- | --- | --- |
| 1 Agent 页二级布局 | c5545906 | 左栏 224px 列表 + 右栏 DetailHeader；额度用 Cindy 的 `QuotaHoverCard` 嵌入态（已去掉计费、本轮明细）和 `usageCardModel`（新增 `buildNativeAgentUsageCard`）。`AgentQuotaRow` 已删。 |
| 2 模型栏悬停提示 | 84ce6945 | 名称 / 账号 / 周限剩余 / 重置倒计时；额度条仍只在选中引擎上显示，颜色按 warn/crit。 |
| 3 菜单栏额度 | 68965f3f | `menubar/quotaSources.ts` 生成 Cindy 的订阅额度管（每个 CLI 一根，按最紧窗口的剩余量）和标题句；面板打开时最多每 5 分钟重读一次。详情页、花费账本、币种、用量图表未恢复。 |
| 4 删除「工具」页和自定义 MCP | 19697e49 | 连同 `plugins:list` / 项目级插件开关 IPC。`custom_mcp_servers` 表暂留。 |
| 5 侧边栏去掉「插件」 | 94f03487 | `/plugins` 重定向到设置 → 插件；所有插件深链改用 `pluginSettingsPath()`。 |
| 6 存储空间页 | ea58f0a7 | 代码本来就是 Cindy 原样（之前说「B4 删出来的卡片套卡片」不对）。改成扁平分区：去掉页标题、数据库卡片里不再套框、提示条改为「维护」分区的说明。 |
| 7 添加项目 | 0cb31a1d | 项目段头常驻「添加项目」，main 里弹目录选择器（可多选），只把选中目录写进 `recent_workdirs`，不新建任务。 |

B5b 期间发现的问题：
- 菜单栏 helper 仍要求 `MBActivity.companion`，main 早已不发这个字段：只要有任务，整条更新解码失败，面板一直是空的。已在 68965f3f 修复（旧 helper 喂同一份数据可复现 `keyNotFound: companion`）。
- 「联系人」设置组件（`components/settings/contacts/`）已没有任何设置页入口，后端 `maker-contacts-host`、contacts IPC 仍在。列为「待确认」：要么整块删除，要么给入口。
- 新增 ui:check 页面：`storage-settings`；`agent-settings` 改为逐个 CLI 截图。菜单栏面板无法用 ui:check 验证，需要在 Desktop 里看。

---

## B6 启动瘦身与实测

0. 先跑 desktop 和 mobile 全量单测（`pnpm exec vitest run`）。B5b 结束时 desktop 是 52 个文件 / 178 个用例失败，mobile 是 11 个文件 / 20 个用例失败，都是前几批删功能留下的（例如还在读 `main/updateService.ts`、`main/plugin-market/` 的测试）。删掉引用已删除模块的孤儿测试；保留功能的失败要修实现或写明原因。结束时两边全量都要 0 失败（llamaCppDownloads 已随本地模型删除，不再是例外）。
1. 只在需要时创建窗口：「资源用量」窗口（启动时创建了 2 个）、侧边栏标签窗口等隐藏窗口改为首次使用时创建。
2. 主进程：重型模块改为按需加载（`await import`），启动路径只加载主窗口需要的部分。
3. 渲染进程：mermaid、KaTeX、PDF.js、CodeMirror 语言包、`@google/model-viewer` 等改为按需加载（`React.lazy` 或动态 `import()`）。
4. 实测：开发模式启动后，在主界面空闲时用 `footprint` 按进程记录内存，和基线对比，结果写回本文件末尾。

---

## B7 恢复 Cindy 登录（只用于远程）

远程连接（我的设备、同账号远控、中转服务）依赖 Cindy 账号。用户决定保留 Cindy 登录，让远程沿用 Cindy 的官方中转和设备配对。登录**只**服务于远程，其余部分保持 B3 之后的状态：

- 从快照 `fbb1010f` 恢复账号登录所需的最小部分（`authManager` 及其依赖、登录回调、钥匙串存储、device-link 的账号接线），只恢复远程用得到的路径。
- **登录是可选的**：不恢复启动时的登录页，应用不登录也能完整使用；入口只放在「设置 → 远程连接」里（登录、显示账号、退出）。
- **数据 owner 不随账号变化**：仍固定为本地 owner（`local-v1`）。Cindy 按账号切换数据库命名空间的逻辑不要恢复，登录、退出都不能影响本地会话和设置。
- **不恢复**：模型网关、供应商、计费、云端点清单、心跳、账号注销、组织/企业 SSO 相关的产品功能。账号 token 不能进入任何引擎的环境变量或启动参数。
- 恢复后重新显示「我的设备」和「中转服务」；「本机应用连接」已在 B4 删除，不恢复。
- 风险：Cindy 服务端可能校验客户端版本、应用标识（`cindy-version-protocol`、device-link 的 `cindy` 系 app id）。实施前先确认用快照里的哪些标识能通过，报告里写清实际结果；loom 自身的 bundle id、深链 scheme 不要改回 Cindy。

第 0 步调查与实施证据见 [`b7-remote-auth-plan.md`](b7-remote-auth-plan.md)。Global Google Play 0.1.28 已登录同账号，列表、打开和已有原生会话发送成功；连续 1,812.846 秒 / 60 次采样保持在线，HTTP 心跳为 0。登录、退出、再次登录与重启恢复已实测，owner 保持 `local-v1`。手机新建的 GUI UUID 与原生 ID 契约冲突已按用户确认的方案 §8.6 修复：所有 GUI 使用 UUID，三家原生引用单独绑定；官方手机随后确认新建发送成功，旧会话仍可打开。实际窗口显示新会话的准确验收回复，loom 版本保持 0.1.120。最终检查与空 profile 重建结果见方案 §8.8。

---

## C1 原生会话：项目下列出三家 CLI 的全部会话（B6 之后马上做，优先于 B7）

目标（loom 的核心，照 ccgui）：用户添加一个文件夹作为项目后，侧栏这个项目下直接列出该目录的**所有** Claude Code、Codex、Pi 会话，不管是在 loom 里还是在终端里建的；点开就是原生内容，在终端里接着聊，loom 里也会跟着变。

**不是导入。** 不把对话复制进 loom 的数据库（Cindy 的「导入会话」在 B4 已按 P1/P2 删除，这是对的，但当时没把替代方案排进来，留下了空档）。loom 只允许有**派生索引**：可删、可重建，只存定位和展示用的元数据（引擎、原生会话 id、文件路径、cwd、标题或首条预览、最后活动时间、mtime/size），不存消息内容。删掉 loom 数据目录后重新扫描即可恢复。

做法（细节见 `spike-cindy-native-projection.md` §8、§9，以那里为准）：
1. **列表**：用各家官方接口，不自己解析文件格式。Claude 用 Agent SDK `listSessions` / `getSessionInfo`；Codex 用 app-server `thread/list`（按 cwd 过滤，含已归档）；Pi 用用户自己安装的 pi 包里的 `SessionManager.listAll()`。结果写进派生索引表，按项目目录归组（worktree 子目录归到主仓库，沿用 `normalizeWorkingDirForGrouping`）。
2. **刷新时机**：照 ccgui，不用文件监听，在这些时机重新扫描：添加项目时、一轮对话结束后、窗口重新获得焦点且距上次扫描超过 5 分钟、用户手动刷新。扫描按文件 size + mtime 签名判断，没变的会话直接沿用索引，不重新读取。
3. **读内容**：打开会话时现读：Claude `getSessionMessages`（`includeSystemMessages`）、Codex `thread/items/list`、Pi `SessionManager.open` + `getBranch()`；转成 Cindy 的 `Message` 行，转换复用实时翻译器，历史和实时一致。`local-db:sessions:*`、`local-db:messages:*` 这组通道改为由索引 + 现读提供数据。
4. **继续对话**：用原生会话 id 续接（Claude `resume`、Codex thread、Pi `--session`）；在 loom 里新建的会话本来就写进各家原生目录。
5. **Pi 回到原生目录**（原「瘦身之后的第一项」并入这里）：去掉 `PI_CODING_AGENT_DIR` 和 `--session-dir`，用用户自己的 `~/.pi/agent`；loom 需要的桥接扩展用 `-e` 临时加载，不写进用户目录。否则 loom 里建的 Pi 会话终端看不到，也违反 P0/P3。
6. **验收**：在 loom 里添加 `loom` 仓库目录，侧栏立刻出现终端里用 Claude Code、Codex 建过的会话；在终端里对其中一个继续发一条消息，loom 里该会话随之更新；删掉 loom 数据目录重启后列表完全恢复。

先做 spike §9 的三条待实测（Codex 读锁、Pi 只读打开、Claude SDK 版本兼容），再动通道实现。

---

## 每批验收

- `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck` 以及受影响包的 typecheck 全部 0 错误。
- `pnpm test:unit:related` 通过（已知失败见 `AGENTS.md`）。
- `pnpm dev:desktop` 能启动到主界面，没有新的 `[ERROR]` 日志。
- 提交信息与报告按 `AGENTS.md` 的格式写。

---

## B6 完成记录（2026-10-31）

### 第 0 步：全量测试归零

- 整块删除 8 个已退役功能的测试文件：自动更新重启、插件市场、旧账号迁移、供应商模型同步、托管 Claude 安装来源、旧远程模型记忆、权限/语音辅助窗登记等。混合测试保留当前功能的断言，移除分享、IM、自动化、向量检索、语音及 WorkLouder 的退役分支。
- 测试夹具对齐当前 schema、原生 CLI 模型目录和资源页签命名；历史 migration 保持原样。远程模型选择新增交互测试，首页设备身份、任务状态、预览和列表密度断言继续保留。
- 修复保留功能的真实回归：远程历史搜索在分页前过滤已删除任务；本地无匹配工作目录短路；输入框异步焦点引用随当前锁定状态更新；模型面板定位选中行；PR 按钮明确使用窗口非拖拽区域；启动页字号使用既有 token。
- 业务逻辑审查：远程不可见任务与不存在任务保持相同空结果诊断，模型切换失败保留选择状态，焦点与输入锁定契约通过。代码设计审查：修复直接回到现有查询、组件和窗口样式路径，清理退役测试与空 suite。

验证（命令均在对应 app 目录运行；原生测试使用允许本机端口、进程及 Swift 缓存的执行环境）：

| 检查 | 实际结果 |
| --- | --- |
| desktop `pnpm exec vitest run` | 2204 文件通过、5 文件跳过；32811 用例通过、32 用例跳过；0 失败，599.86 s |
| mobile `pnpm exec vitest run` | 691 文件通过；9716 用例通过；0 失败，256.52 s |
| desktop 审查后补测（自动起名、模型接线、历史可见性、远程选模） | 4 文件、36 用例通过 |
| mobile 审查后补测（消息工作租约及历史入口） | 1 文件、9 用例通过 |
| `pnpm --filter desktop run typecheck` | 0 错误 |
| `pnpm --filter mobile run typecheck` | 0 错误 |
| `pnpm ui:check --changed --theme all` | 原生模型面板 light/dark 共 2 项通过；输入框、启动页和 PR 按钮由最终 Desktop 启动检查补充 |

首次受限环境全量运行实际为 desktop 89 文件 / 445 用例失败，mobile 14 文件 / 24 用例失败；其中包含本机端口、进程和 Swift 缓存权限造成的额外失败。上表记录完成清理与修复后的完整复跑结果。全量仍跳过的 5 个 desktop 文件为现有按环境启用的原生/端到端测试。

### 第 1 项：辅助窗口首次使用时创建

- 删除主窗口首帧后的资源用量/侧栏标签预热定时器。资源用量窗口首次打开才创建，关闭后隐藏复用并暂停采样；隐藏窗口重载保持采样暂停。
- 删除侧栏标签的 spare 窗口、补建定时器和 spare 崩溃重建分支；新窗口直接绑定实际页签，页签关闭或归还后销毁。保留多页签合并、首份内容握手、Loading 展示、来源校验及崩溃归还。
- 分离右侧栏原本就由实际打开请求建窗，本次沿用。原生拖拽松手 helper 预热继续保留，它不创建 Electron Renderer。安全与进程边界文档的窗口生命周期已同步为 loom B6 的按需策略。
- 业务逻辑审查：三平台首次使用前零建窗、隐藏后零采样、重复打开复用，以及 owner/页签归属和有界恢复通过。代码设计审查：移除整条预热和备用窗口状态路径，窗口槽从创建起持有有效指派。
- 验证：`pnpm exec vitest run src/main/resource-usage-window src/main/sidebar-tab-window src/main/right-sidebar-window src/main/__tests__/sessionRuntimeControlWiring.test.ts`，13 文件、264 用例通过。desktop 与 mobile typecheck 均为 0 错误。

### 第 2 项：主进程重型依赖按需加载

- JSZip 在插件包检查、打包、导出、签名/审核及工具 ZIP 解压时动态加载，所有生产入口均移除顶层值导入。TAR 在目录传输、工具解包和 worktree 恢复归档时动态加载；流式目录打包调用方统一等待模块加载后再建立管道。
- 自建中转内核在用户启用本机中转时动态加载；新增 `@cindy/device-link-relay/credentials`、`/version` 轻量子路径，设置与配对身份工具继续可用。动态加载之后检查发起时的 owner，再操作中转目录、秘密和服务句柄。
- 业务逻辑审查：签名、包大小/路径/链接限制、文件传输取消、worktree 归档校验、中转账号代次隔离通过。代码设计审查：使用原生动态 import 缓存，沿现有异步功能边界加载，继续复用现有模块。
- 验证：desktop 的 managed-tools、file-browser、worktree、四个插件包核心测试及中转 runtime/deploy 测试，共 31 文件、826 用例通过；取消边界补测 1 文件、6 用例通过。relay 包 `pnpm exec vitest run` 全量 3 文件、44 用例通过；desktop、mobile、`@cindy/device-link-relay` typecheck 均为 0 错误。

### 第 3 项：渲染端富内容按需加载

- KaTeX 插件与 CSS 移到动态入口，含数学定界符的正文首次出现时加载；普通正文使用轻量插件链。两条链共用顺序构造，继续保留行内/块级公式、流式渲染、代码围栏隔离和公式复制操作。
- Mermaid 库原本已在图块/编辑器 widget 首次渲染时动态加载；本次再把聊天 Mermaid 图块组件设为 `React.lazy`，加载期间显示原始代码。PDF.js 通过 `LazyPdfPreview` 在 PDF 文件面板挂载时加载，沿用既有 worker、字节 IPC、虚拟页和位图预算。
- CodeMirror 按当前语言动态加载各 `lang-*`/legacy parser；先建可编辑文本视图，再通过 Compartment 原位启用解析与高亮。快速切文件、组件销毁和大文档路径分别验证，文本、编辑器实例与用户焦点保持稳定。
- `@google/model-viewer` 从主 renderer 入口移至 3D 弹窗首次挂载；模块加载失败时提示错误并保留预览图和关闭操作。
- 业务逻辑审查：公式、围栏、流式内容、编辑与焦点、PDF 原有渲染边界通过。代码设计审查：按现有功能边界拆分模块，重用解析器、插件链、错误提示和预览生命周期。
- 验证：渲染端相关测试 70 文件、734 用例通过；新增 3D 导入失败与焦点补测 2 文件、4 用例通过；实际插件顺序补测 2 文件、28 用例通过。desktop/mobile typecheck 均为 0 错误。`pnpm ui:check --changed --theme all` 最终 24/24 场景通过，已查看全部页面及富内容截图；`pnpm ui:check:selftest` 5/5 通过。
- UI 检查沙箱补齐正式应用已有的 `wasm-unsafe-eval` 编译权限，JavaScript eval 与外网限制继续生效。自测中的退役 bot 翻译键改用现存键，继续验证多层级键与普通点分文本的区别。FileBodyView/PDF 动态入口、主 renderer 入口由最终真实 Desktop 检查补充。

### 第 4 项：真实启动与逐进程内存实测

2026-10-31，macOS 26.6.2 / arm64 / 24 GiB，Electron 42.11.12。使用：

```sh
XDT_CDP_PORT=9331 pnpm dev:desktop --isolated=loom-b6-measure
ps -axo pid=,ppid=,rss=,command=
footprint --noCategories --format bytes --json <output.json> <本次实例的 PID 列表>
```

新建独立 profile，进入主界面新对话页，0 任务，保持空闲；采样实例从未打开资源窗口、弹出侧栏或富内容预览。构建和全量测试已结束。按本次 Electron 父进程及其子进程统计，并补入同 profile 的 Crashpad；Forge、Vite、pnpm 与其他应用实例排除。完整字节数与每次 PID 记录见 [采样数据](./measurements/b6-memory-2026-10-31.json)。

主界面就绪后约 74、132、232 秒分别采样，工具均返回 0 错误、0 告警：

| 本地时间 | Electron 进程数 | RSS 合计（MiB） | phys_footprint 合计（MiB） |
| --- | ---: | ---: | ---: |
| 02:29:36 | 5 | 540.0 | 577.1 |
| 02:30:35 | 5 | 392.6 | 570.6 |
| 02:32:14 | 5 | 336.3 | 570.5 |

以下使用三次 RSS 的中位样本（02:30:35），物理占用取同次 `footprint` 的 `auxiliary.phys_footprint`。两列分别记录驻留内存与物理占用；本次未强制 GC 或清理缓存。

| 进程 | PID | RSS（MiB） | phys_footprint（MiB） |
| --- | ---: | ---: | ---: |
| Electron 主进程 | 56910 | 159.9 | 180.4 |
| 主界面 Renderer | 57547 | 116.4 | 250.7 |
| GPU | 57523 | 65.3 | 125.7 |
| Network Service | 57524 | 43.7 | 11.7 |
| Crashpad | 57510 | 7.3 | 2.1 |
| **Electron 小计：5 个** | | **392.6** | **570.6** |
| 原生拖拽 helper | 57608 | 24.2 | 6.4 |
| 原生菜单栏 helper | 57764 | 35.1 | 10.3 |
| 用户安装的 Codex app-server（模型目录探测后常驻） | 57826 | 71.0 | 93.2 |
| **本次实例完整进程树：8 个** | | **522.8** | **680.5** |

对照给定的「登录页、12 个 Electron 进程、RSS 约 707 MB」基线：Electron 进程减少 7 个（约 58%）；中位 RSS 约 393 MiB，相对给定近似值减少约 314 MB（约 44%）。三次 RSS 为 336–540 MiB，物理占用为 570–577 MiB。基线与本次页面不同，RSS 也会随系统驻留页回收变化，这组数字用于观察性对比；`phys_footprint` 保留本次绝对值，未用它与 RSS 基线计算降幅。

真实 Desktop 验证：

- 主界面正常进入，输入框与模型入口正常呈现；采样时只存在一个主界面 Renderer。
- 在前一个独立检查实例中，通过实际 FileBodyView、preload 字节 IPC 与 PDF.js worker 绘制仓库 `resources/dmg/background.pdf`；1 页 canvas 为 2429×1646（3,998,134 像素，符合既有 4M 像素预算）。临时挂载入口已删除，worker 随卸载释放。
- 资源监视器首次调用 open 才产生第二个 Renderer，首份进程表正常显示；关闭后 `visibilityState=hidden`，内容继续挂载以供复用。该检查实例已退出，未纳入采样。
- 首次冷预构建与全量测试并行时，已有的 30 秒开发启动护栏触发两次自动重载，随后恢复。采样前独立重新启动，最新启动日志 **0 条 `[ERROR]`**。

### B6 收尾验证与提交

| 检查 | 实际结果 |
| --- | --- |
| desktop `pnpm exec vitest run`（最终独立全量） | 2208 文件通过、5 文件跳过；32823 用例通过、32 用例跳过；0 失败，355.77 s |
| mobile `pnpm exec vitest run`（最终全量） | 691 文件、9716 用例通过；0 失败，234.00 s |
| desktop/mobile/relay typecheck | 全部 0 错误（各代码项提交前完成） |
| 渲染端 UI / UI runner 自测 | 深浅色 24/24 场景、自测 5/5 通过 |

最后一次并行全量中，文件监听等待与 2.5 MiB 文件上传各出现一次时限失败；停止构建后，在原断言、原超时配置下单独复核 2 文件 / 68 用例全部通过，上表随后独立完整复跑同样全部通过。

| 批次 | 提交 |
| --- | --- |
| 第 0 步：孤儿测试清理与保留功能修复 | `0ab0cfbf` |
| 第 1 项：辅助窗口按需创建 | `b25b923b` |
| 第 2 项：主进程重型依赖按需加载 | `f2814272` |
| 第 3 项：渲染端富内容按需加载 | `8d593662` |

后续批次：保留插件框架、远程、文件/终端/Git/worktree、三家 CLI 适配执行和现有 localDb 数据源；历史 migration 保持原样。本批未删除业务包、IPC 通道或设置项。B5b 的联系人孤立后端仍列为「待确认」。C1 按上文继续原生会话索引与现读；重型功能的内存成本在首次使用时产生，后续性能比较应沿用同一页面、profile 和采样时点。

## C1 实测与索引方案（2026-10-31，已确认）

状态：第 0 步已实测。曾按本次任务「索引需要新表时，先停下来在报告里写方案，等确认后再做」的要求暂停实施；用户明确回复「确认新增独立派生索引表（建议）」，现继续实现扫描器、读取、续接和 Pi 原生目录切换。

### 第 0 步结果

完整方法、版本边界和聚合证据见 [`spike-cindy-native-projection.md` §10](spike-cindy-native-projection.md#10-c1-读取实测2026-10-31) 和 [`measurements/c1-native-read-2026-10-31.json`](measurements/c1-native-read-2026-10-31.json)。

- Claude SDK 0.3.292 + 用户 CLI 2.1.314：loom 目录下 1 个会话，73 条普通消息 + 4 条系统消息，原文件签名不变。兼容性仅覆盖该版本组合。
- Pi 1.4.0：15 个原生会话的临时 `0400` 副本全部成功 `open()` / `getBranch()`，均为 v3，合计 5,682 个分支条目；15 个原文件签名不变。loom 目录下当前没有 Pi 会话。另一个临时 v3 样本缺少末尾换行时，`open()` 在只读权限下报 `EACCES`，可写时补写 1 字节。内容读取统一使用临时副本，官方迁移和末行修复仅作用于副本。
- Codex 0.166.0：loom 目录下 3 个非归档会话；未加载会话 2,224 个 item / 23 页、App 持锁会话 1,055 个 item / 11 页均可读，读取方始终未加载线程，原文件签名不变。隔离双进程实验从 1 个 item 更新为 2 个，新增内容可见且旧 id 稳定。归档样本读到 12 个 item。
- Codex `thread/unsubscribe` 返回成功后 3 秒仍持写锁，第二个写入者 resume 被拒；原写入进程退出后 resume 成功。后续续接按进程生命周期释放写入者，读取方保持只读。
- 全局升序 `thread/list` 默认 metadata 修复模式有一次 30 秒超时；`useStateDbOnly: true` 成功，但会跳过发现修复。压缩样本尚未覆盖。

### 现有表复用评估

| 现有表 | 已有能力 | 评估 |
| --- | --- | --- |
| `sessions` | 引擎、sdk_session_id、cwd、标题/列表预览、活动时间，以及置顶等 UI 状态 | 缺少原生文件路径、size、mtime；目前还被运行时用于模型/用量等会话事实写入。直接当派生索引会继续混用会话事实与 UI 状态，需要拆开读写职责 |
| `skill_usage_sources` | 原文件路径、引擎、原生 id、size、mtime | 原职责为 Skill 统计源缓存；现有 `skillUsage.applyMutation` 会按分析版本和保留时间删除行，且被 `skill_usage_exposures` 外键引用。与 sessions 拼接在列形状上可行，但要重定义统计表及其清理契约，不作为本次直接复用方案 |
| `migration_meta` | key/value | migration 与分析版本状态；用于承载会话索引会混入业务数据，失去明确的列约束和查询边界 |
| `recent_workdirs`、`project_aliases` | 项目列表、别名 | 按现有职责复用，保存用户的项目选择。全新 loom 数据目录需重新添加项目，再从原生目录重建会话列表 |

以上评估基于 `apps/desktop/src/main/localDb/schema.ts`、`maker-host/session-storage.ts`、`localDb/worker/opHandlers/tx.ts` 和 `localDb/client/WorkerThreadTransport.ts`。采用已确认的独立新表，旧表的运行时读写在后续读取、续接步骤中替换。

### 建议确认的最小新表

用户已确认新增独立 `index.sqlite`，与现有 loom 数据库分开；扫描器以此表存储元数据：

```sql
CREATE TABLE native_sessions (
  engine TEXT NOT NULL CHECK (engine IN ('claude-code', 'codex', 'pi')),
  native_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  cwd TEXT NOT NULL,
  title TEXT,
  first_preview TEXT,
  last_activity_at INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  PRIMARY KEY (engine, native_id)
);
CREATE INDEX native_sessions_cwd_activity
  ON native_sessions(cwd, last_activity_at DESC);
```

- 文件路径取 realpath；工作目录保留官方 cwd，分组时调用现有 `normalizeWorkingDirForGrouping`。索引没有消息、工具输出、全文搜索、模型、用量和凭据列。
- 文件 size + mtime 相同则沿用已有索引元数据；内容在打开会话时通过官方 API 现读。Pi `listAll()` 返回的 `allMessagesText` 只存在于本次调用内存，写索引时逐字段取值。
- 新表不引用旧 sessions/messages 表，删除 `index.sqlite` 后由官方列表重建。置顶、项目别名等 UI 状态继续由 UI 元数据职责管理，不以它们决定原生会话是否存在。
- 建议对这个可丢弃索引使用独立 schema 版本，版本变化时重建；不改 `apps/desktop/drizzle/` 历史 migration，不为创建新表绕开本次确认要求。
- 确认后按「扫描器 / 读取 / 续接 / Pi 原生目录」分别实现和提交。需要替换运行时的会话/消息事实持久化，审计 desktop/mobile 的消息磁盘缓存，删除编辑消息等平行层入口，让 device-link 复用同一套索引与现读通道。实时叠加层只放内存，持久化只承载允许的索引元数据和 UI 偏好。

### 本次交付与待验收

第一个实现提交增加 `@loom/native-sessions`、元数据索引 worker、三家官方 lister，以及添加项目、轮次结束、焦点间隔的刷新接线。新增 `native-sessions:refresh` IPC 和 `native-sessions:changed` 事件；界面按钮与列表/内容源替换在下一步完成。没有删除业务目录、包或设置项；历史 migration 保持原样。未 push。

实现前基线：desktop/mobile typecheck 均退出 0；desktop 全量 2,208 文件通过、5 文件跳过，32,823 用例通过、32 跳过、0 失败（451.83s）；mobile 全量 691 文件、9,716 用例通过、0 失败（175.19s）。首步定向验证：索引包 2 文件 / 7 用例、desktop 项目相关 4 文件 / 23 用例通过。

确认前尚未进行 C1 的界面验收：添加项目立即出现终端会话、终端续聊后的 UI 刷新、loom 新建 Pi 后终端续接、删掉 loom 测试数据目录后的完整重建。UI 与完整 Desktop 启动验收留在实现完成后执行，当前状态不代表 C1 完成。

读取批次已把本机普通会话列表与消息读取切到索引和官方 API；device-link 复用同一 handler，SSH 会话保留现有执行路径。历史转换复用三个实时翻译器，原生 ID 作为消息锚点；正文和图片仅驻留内存，desktop/mobile 原生消息磁盘缓存关闭。手动刷新按钮、远程失效事件和 worktree 归组投影一并接入。Claude 的 4 条系统记录缺少 SDK payload，界面显示原生记录提示，限制见 spike §10.1。

读取批次验证：desktop/mobile typecheck 均退出 0；maker-core build、native-sessions typecheck 均退出 0。desktop 定向 4 文件 / 234 用例、原有数据通道回归 8 文件 / 236 用例，mobile 定向 3 文件 / 420 用例，核心历史转换 1 文件 / 4 用例通过。真实 Claude 样本的 77 条 SDK 记录转换为 4 个系统提示、2 个用户输入、8 个文本块、19 个思考事件、22 个工具调用和 21 个工具结果，未复制消息。首次 `pnpm ui:check --changed --theme all` 为 146/150，通过之外的 4 个场景均为既有视频全屏菜单超时；正在独立复核，并新增原生索引界面场景覆盖刷新按钮和提示。

续接批次：本机普通新会话分配原生 id，使用同一标识续接；Pi 在适配边界把索引 id 解析为官方会话文件路径。实时消息与工具媒体只留内存，轮次结束后由官方历史替换；Codex 使用独立写入进程并在空闲收尾后退出以释放锁，官方读取进程继续运行。新增 `native-ui.json` 仅记录用户明确选择的 UI 偏好，不保存原生消息或扫描得到的模型/用量。原生消息编辑、删除、回退、旧数据库 fork 和跨引擎切换入口被限制，`/clear` 转到新建页。远程原生 DTO 与正文均不写 desktop/mobile 的磁盘镜像。

已通过：desktop/mobile typecheck（后续复核使用 TypeScript incremental，缓存置于 `/tmp`，0 错误）、maker-core build、native-sessions typecheck；desktop 定向 5 文件 / 504 用例，加事件流与缓存 2 文件 / 171 用例；mobile 缓存 2 文件 / 56 用例；maker-core 2 文件 / 969 用例通过、11 跳过；索引包 2 文件 / 7 用例通过。新增界面场景中英文明暗主题 4/4 通过，已查看截图。视频全屏菜单独立复核仍为 4 个场景超时，保持原断言与原时限，完整界面检查仍有这项待确认。

真实窗口已通过“添加项目”选择 loom 仓库，自动索引到 Claude 1 个、Codex 3 个既有会话；点击 Codex 原生会话可见原文。长历史首次打开发现概要携带工具全文导致扫描预算超限，已改为有界概要、展开现读全文，并增加 3 MB 工具正文回归用例。修正后的独立启动、续聊、Pi 目录和删除测试 profile 后重建验收继续进行，尚未标记 C1 完成。

Pi 原生目录批次：执行继承用户的 Pi home，默认 `~/.pi/agent`；移除 app-owned sessions 目录创建，以及 fork/旧 runner 的 `--session-dir`。loom 临时桥接文件归入 `pi-runtime`，以显式 `--extension` 加载，退出时清理。原生 Pi 会话停用会复制转录的旧 Cindy subagent runner；用户自己的 Pi 扩展继续由 CLI 加载。续接前核实索引文件可读，启动后核实官方返回的原生 id。Pi 历史模型使用 provider/model 标识，下一轮模型取当前 CLI 目录中的有效值。

同轮审查修正首轮 UI 模型/权限选择的保留、Codex 未生成 rollout 的空会话发现、归档移动后的官方重新定位，以及新建失败时释放未发布 Codex 进程。验证：desktop/mobile typecheck、maker-core build、native-sessions typecheck 均退出 0；Pi 核心测试 44 文件通过、5 跳过，1,318 用例通过、117 跳过；desktop Pi 3 文件 / 31 用例，投影后端 1 文件 / 9 用例，历史转换 1 文件 / 4 用例，索引包 2 文件 / 8 用例均通过。mobile 最终全量 691 文件 / 9,716 用例，0 失败（84.50s）。desktop 最终全量与真实续聊验收继续执行。

### 原生续接边界审查与实际验收进展

业务审查切断原生会话进入旧 Cindy 转录处理的路径：Claude resume 跳过复制/归位和工具 id 修补，附加目录重建沿用同一 id；Codex 跳过导入预检、旧存储复制和私有 rollout 计划轮询，核实 resume 返回的 id。Codex 新会话在官方 `thread/start` 分配 id 时就应用首轮目录权限；需要替换 id 的旧配置恢复路径对原生会话明确报错。Pi 原生会话跳过旧 JSONL 扫描器。原生 Session 与历史翻译的应用日志仅保留等级、scope/id，Claude 原生运行也关闭 loom 的原始网络 debug 文件，避免 trace 模式另存消息。

Pi 实测发现并修复旧 `set_auto_compaction` 的全局配置副作用，细节与精确回滚的待授权状态见 spike §10.5。修正后 Pi 全套 44 文件通过、5 跳过，1,317 用例通过、117 跳过；减少的 1 个测试对应已删除的“强制写入用户压缩设置”行为。Claude/Codex 适配器回归 3 文件 / 1,005 用例通过、11 跳过；原生日志与后端 3 文件 / 19 用例通过；原 SQL 测试按保留的 SSH 范围装配，新原生数据源独立验证置顶、状态、分页和历史，相关 5 文件 / 65 用例通过。原有行为断言与超时配置保留。

desktop 独立全量复跑：2,209 文件通过、5 跳过；32,835 用例通过、32 跳过，0 失败（344.46s）。随后日志边界新增 3 个用例，最终检查继续执行。两轮真实 Pi 生产适配器/终端往返成功；生产索引删除临时 profile 后重新扫描，18/18 个原生 id 恢复（Claude 1、Codex 15、Pi 2），9 列结构和源文件签名检查通过。

完整 Desktop 尚待：锁屏解除后的新建 Pi 与终端追加刷新，以及删除测试 profile、重启并重新添加项目的界面核对。已通过的原生文件夹选择与 Codex 原文显示仍保留；当前不标记 C1 完成。两项用户输入待处理：解锁 Mac，以及授权恢复实测新增的 Pi 配置项。未 push。

### C1 最终检查记录（2026-10-31，完整界面验收待输入）

| 检查 | 命令 / 实际结果 |
| --- | --- |
| desktop 全量 | `cd apps/desktop && pnpm exec vitest run`；2,209 文件通过、5 跳过，32,838 用例通过、32 跳过，**0 失败**；303.57s |
| mobile 全量 | `cd apps/mobile && pnpm exec vitest run`；691 文件、9,716 用例通过，**0 失败**；84.50s |
| desktop / mobile 类型 | `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck`；均 0 错误。最终复核加 `--incremental --tsBuildInfoFile /tmp/loom-c1-<平台>.tsbuildinfo`，TS 检查配置与范围保持原样 |
| 受影响包类型 | maker-core、maker-shared、device-link 的 `pnpm --filter <包名> run build`（均为 `tsc --noEmit`），native-sessions 的 `run typecheck`；全部退出 0 |
| 受影响包测试 | native-sessions 2 文件 / 8 用例；device-link 3 文件 / 67 用例；maker-shared 3 文件 / 73 用例；均通过 |
| 新增界面 | `pnpm ui:check --page native-session-index --theme all --locale zh-CN,en`；4/4 通过，已查看最终截图；产物 `artifacts/ui-check/native-session-index-jCNgb3/` |
| 全部改动界面 | `pnpm ui:check --changed=3b9d8608 --theme all`；最新独立运行 137/152 通过，**15 失败**：4 个视频菜单超时、3 个邮件布局 ResizeObserver 通知、8 个任务错误场景导航超时及后续 Electron 窗口关闭。3 个改动文件未被 fixture 覆盖（其中 2 个为类型声明）。保持原断言与时限，失败仍列为待确认；产物 `artifacts/ui-check/changed-NZ35ro/` |
| 视频交叉复核 | 同 4 个视频场景使用仓库支持的 Chromium 引擎，4/4 通过；这项结果单独记录，完整 Electron 检查仍按上一行报告 |
| 最终实际启动 | `pnpm dev:desktop --isolated=loom-c1-native`，最终代码已重启，日志 **0 条 `[ERROR]`**，长历史概要预算错误为 0；真实 profile 索引为 Claude 1 / Codex 15 / Pi 2 |
| 原生数据边界 | 实际 profile 的 `sessions` 与 `messages` 表中，原生 id 对应记录均为 **0 行**；`index.sqlite` 仅 9 列、权限 `0600`；临时 profile 删除重建 18/18 id 恢复 |

实际验收状态：

- 已在真实窗口通过添加文件夹选择 loom，立即列出既有 Claude/Codex 会话，并打开 Codex 原文。
- 生产 Pi 适配器创建 → 用户原生目录 → 终端 Pi 相同 id 续接 → 官方读取两轮，已通过；两条测试会话留在 CLI 原生目录。Desktop 新建按钮和终端追加后的侧栏刷新仍待解锁后核对。
- 生产索引整目录删除重建已通过。完整 Desktop 测试 profile 删除、重启、重新添加项目后的界面核对仍待解锁。项目选择与置顶属于 UI 元数据，删除后需要重新选择项目。
- Mac 在最终尝试时仍锁定。Pi 首次实测的 43 字节配置新增项仍保留，精确恢复候选已核对 SHA-256，等待用户对 P0 的回滚例外授权。

业务逻辑审查已修正原生事实持久化、历史稳定 id、运行时并发收尾、CLI 配置副作用和私有格式路径；代码设计审查复用了实时翻译器、现有 IPC/远程通路与目录归组，派生索引和 UI 偏好各自独立。剩余验收与 UI 失败按上表保留，C1 尚未标记完成。

本批没有删除业务目录、包、IPC 通道或设置页；新增 `@loom/native-sessions`、`native-sessions:refresh`、`native-sessions:changed`，替换本机普通会话的数据源，限制原生消息编辑/删除/旧 fork/跨引擎搬运入口。保留 SSH、插件、device-link、文件/终端/Git/worktree，以及未进入本机原生链路的旧 Cindy 内部能力，留后续 B7 清理；历史 migration 和 `reference/` 保持原样。Claude 系统记录 payload 与 Codex 压缩样本的边界继续见 spike §10。未 push。

### C1 完成情况（2026-11-01）

用户解锁 Mac 并授权精确恢复 Pi 配置后，已完成剩余界面验收和 15 个 UI 失败的根因修复。上面的“待输入/未完成”是 2026-10-31 的阶段记录，当前结论以本节为准。证据见 [`measurements/c1-native-completion-2026-11-01.json`](measurements/c1-native-completion-2026-11-01.json) 和 [spike §10.6](spike-cindy-native-projection.md#106-完整-desktop-验收闭环2026-11-01)。

| 验收项 | 实际结果 |
| --- | --- |
| 添加项目立即发现终端会话 | 空 profile 启动后，通过系统文件夹选择器添加 loom，侧栏出现 Claude 1 / Codex 18 / Pi 3，共 22 个原生会话；三家内容均可打开 |
| 终端继续后 GUI 更新 | GUI 新建 Pi 原生会话，终端 Pi 官方列表可见并用同一 id 续接第二轮；回到 GUI 手动刷新后，新增输入和回复均显示 |
| GUI 继续使用最新原生上下文 | 第三轮通过 GUI 发送，正确回复终端第二轮设置的口令；官方分支读取确认 3 个用户轮次，读取前后源文件 size/mtime 不变 |
| 删除 loom 数据后恢复 | 测试 profile 完整移至 `/tmp` 留作恢复，原应用数据路径为空；重启并重新添加项目后，22/22 id 全部恢复，Pi 三轮历史完整可读；9 列索引，25 张 SQL 会话关联表中原生记录合计 0 行 |
| CLI 配置 | 精确移除首次 Pi 实测新增的 43 字节，恢复为测试前 1,129 字节原文，SHA-256 相同；最终复核四份 Claude/Codex/Pi 配置均与测试前相同 |
| desktop 全量 | `cd apps/desktop && pnpm exec vitest run`（附 default/json reporter）；2,210 文件通过、5 跳过；32,853 用例通过、32 跳过，**0 失败**，490.72s |
| mobile 全量 | `cd apps/mobile && pnpm exec vitest run`（附 default/json reporter）；691 文件 / 9,723 用例通过，**0 失败**，106.34s |
| 类型 | `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck`，最终复核附 `--incremental --tsBuildInfoFile /tmp/loom-c1-<平台>.tsbuildinfo`；均 **0 错误** |
| 改动界面 | `pnpm ui:check --changed=3b9d8608 --theme all`：**152/152，0 失败**，157.1s；`pnpm ui:check:selftest`：**5/5**；产物 `artifacts/ui-check/changed-hpX1AG/`，已查看截图 |
| 完整应用 | `pnpm dev:desktop --isolated=loom-c1-native`，空 profile 重启、添加项目、打开三家会话期间 **0 条 `[ERROR]`**；fixture 未覆盖的 `CCAgentSessionView` 用真实窗口验证，两个类型声明由 typecheck 验证 |

本次补充修复：原生发送跳过 SQL 轮次租约、活动标记和队列快照，投递回执只保存内存中的 id；mobile 原生待发送队列及历史交接也仅驻留内存。三家空闲 CLI 实例在轮次收尾后退出，下一轮使用相同原生 id 重新加载。新增覆盖三家引擎的 SQL 零访问、代际锁和队列正文零写入断言；desktop 定向 6 文件 / 94 用例、mobile 定向 4 文件 / 156 用例通过。

15 个 UI 失败的处理：视频宿主仅允许测试 origin 的 DOM fullscreen；邮件 iframe 高度重算退出 ResizeObserver 同步通知周期；长批次每个场景使用独立渲染生命周期，避免复用 WebContents 后导航停止响应。原高度、菜单、焦点、脱敏、视口等断言与超时保持原样，没有过滤错误或跳过场景。

业务逻辑审查已核对原生事实源、CLI 配置边界、外部追加后的执行上下文、刷新及空 profile 重建；代码设计审查已核对共享实时翻译器、IPC/远程路径、原生 id 判定、内存回执职责和观察器清理。两轮审查发现的问题均已修复并复验。

待确认与后续边界：Claude SDK 0.3.292 的 4 条系统记录缺少 payload，界面保留原生记录提示；当前环境没有官方 API 返回的 Codex `.zst` 样本，待出现样本再补验。原生待发送队列遵循 P1/P2，进程重启后只恢复 CLI 已接受的历史。隐藏 UI fixture 验证 DOM fullscreen，原生 OS Space 动画未纳入本次矩阵。前一实例退出时 `CodexAgent.dispose()` 的两条 error 级正常清理诊断留后续日志级别清理；最终重启与读取为 0 条 `[ERROR]`。B7 的真实跨设备配对验收另做，C1 已复用现有 device-link 数据通路。

本次没有新增或修改历史 migration，没有删除业务目录、包、IPC 或设置项；保留 SSH、插件、device-link、文件/终端/Git/worktree。扫描器、读取、续接、Pi 原生目录已有独立提交；收尾修复和验收证据继续分批提交，不 push。

| 批次 | 提交 |
| --- | --- |
| 扫描器与第 0 步证据 | `beade785` |
| 官方接口读取与缓存边界 | `493c8298` |
| 原生 id 续接与内存实时层 | `63324cc6` |
| Pi 原生目录 | `63f3c13c` |
| 原生存储边界审查修正与实测 | `93fe5ea0` |


### B7 完成情况与统一身份验收（2026-11-02）

可选 Cindy 远程登录、退出和再次登录已实测；未登录的本地功能与 SSH 保持可用。官方 Google Play Global 0.1.28 已确认新建发送成功、旧会话能打开。HTTP 心跳保持删除，在线依据为 device-link WS，连续 30 分钟实测已通过；认证/device-link 使用 loom 实际 UA 与版本。账号 token 与三引擎 argv/env 的实际匹配均为 0，Codex external auth 没有接回 Cindy 账号。

GUI UUID 与原生引用统一分层，绑定复用 native-ui.json；删除临时 profile 后从空目录重扫，恢复同一组 8 个原生会话（Claude 1、Codex 3、Pi 4），派生 UUID 一致，实际消息现读正确，sessions/messages 仍为 0 行。原已登录 profile 随后恢复，其调用方 GUI UUID 保持原值。没有新增消息副本、表或 migration。

最终 desktop 全量 2,226 文件 / 32,918 用例、mobile 全量 692 文件 / 9,729 用例通过，均为 0 失败；desktop 另有 5 文件 / 32 用例按原环境条件跳过。两端及受影响包类型检查均 0 错误，最终界面矩阵 138/138 通过。最终完整启动及读取为 0 条 [ERROR]，四份 CLI 配置 SHA-256 与用户确认基线一致。具体命令、重建证据、两轮审查结果及未验证边界见 [B7 方案 §8.8](b7-remote-auth-plan.md#88-统一身份调整与官方手机复验2026-11-02)。

待确认继续保留：官方手机已删除功能页面的视觉“不支持”与返回行为，Claude 系统记录 payload、Codex .zst 样本。原生未接受输入只驻内存；清除 UI 绑定后手机旧链接可能需要重新选择会话。临时附件仍被原生历史引用，20 张 / 6,369,836 字节只检查、未清除。业务与设计审查均完成，reference/、历史 migration 和 CLI 配置保持原样；未 push。
