# 会话、侧栏与 Agent 设置验收（2026-11-08）

本批覆盖用户清单的 11 项。界面实现逐项读取 Cindy 源码，逻辑问题先运行失败测试，再替换错误逻辑。开发、替身验收和截图均使用独立应用标识与临时目录；正式 release 按正常标识构建。没有提交或推送。

## 实现与源码对照

以下 Cindy 路径均相对于 `docs/reference/repos/cindy/apps/desktop/src/renderer/`。

| 项目 | 实现结果 | Cindy 源码 |
|---|---|---|
| 1. Codex App 图片 | 识别 `Files mentioned by the user`、`Image attachment: true` 与 `localImage` 组合。后端只读取普通栅格图片，校验扩展名、文件头与 5 MB 上限；文件缺失显示“图片已不在本机”。图片独立消息、时间和标题上下文均保留 | `components/chat/UserMessage.tsx`、`ImageMissingPlaceholder.tsx`；解析契约来自 Codex 原生消息 |
| 2. Codex 写锁 | 提示区分空闲和运行中，持锁方写作“ChatGPT 或终端里的 Codex”（无法从锁文件判断是哪一个），说明在那边关闭任务或退出后继续。每 5 秒探测，锁释放后当前任务自动恢复发送并重读历史 | 沿用 Tandem 写入者提示结构；单写入锁遵循 Codex 原生协议 |
| 3. 本地链接 | 路径、文件名及行号标签显示文件块，说明文字显示下划线链接。点击走系统默认程序，右键提供打开、访达定位、复制路径；网页链接沿用浏览器 | `components/chat/MarkdownRenderer.tsx` 的 `shouldRenderCodeReferenceLabel`、`useFileChipContextMenu.tsx` |
| 4. 文件更改卡片 | 完整 hunk 才累计行数，记录缺失或截断时只显示文件数。删除记录来源提示，保留文件名优先、目录次要及三行预览。撤销和审查保持本批范围之外 | `components/chat/TurnChangesCard.tsx` |
| 5. 工作过程 | 运行中动作段默认最近 5 条，标题切换全部；5 条以内保持静态。完成后中间助手文字与动作一起收进外层组，默认收起，最后回复在外。外层“已处理”、内层“已工作”，缺时间显示“工作过程”，应用内记住各层展开状态 | `components/chat/WorkGroupBlock.tsx` 开头契约、`messageWorkGroups.ts` |
| 6. 分组与排序 | 项目内可建立 Claude Code / Codex / Pi 二级组。支持最近活动、CLI 类型排序，同类型内按时间。筛选按钮和项目右键的悬停二级菜单共用设置，保存到 `config.toml` | `features/cc-agent/sidebar/SidebarFilterPopover.tsx`、`hooks/useSidebarFilter.ts`、`lib/mainListModel.ts` |
| 7. 项目置顶 | 顺序为“对话”分组、置顶项目、其余项目（复审时修正：原实现会把置顶项目排到“对话”之前）；各区内保留项目手工顺序。项目置顶保存在 `state.json` 的 `pinnedProjects`，任务置顶继续沿用 `taskMeta.pins` | `lib/mainListModel.ts`；结合 Tandem 既有任务置顶 |
| 8. 任务行 | 菜单目标保持选中样式与高亮省略号。悬停显示置顶、生成标题、更多（复审时按用户原始要求把重命名换成生成标题），20px 按钮、14px 图标、2px 间距；生成标题使用 Sparkles。归档任务显示生成标题和更多 | `features/cc-agent/sidebar/SessionItem.tsx` |
| 9. 标题栏 | 省略号在菜单打开时保留按下态；左侧新增项目和终端续接命令的图标按钮，提供底部 Tip | `features/cc-agent/SessionContentHeader.tsx`、`components/layout/ContentHeader.tsx` |
| 10. 外观 | 主题、显示模式和语言共用 36px 胶囊下拉，选项含选中标记；布尔项使用切换开关。键盘移动、Esc、焦点移出和窄窗口布局均核对 | `components/settings/AppearanceSection.tsx` 的 `FamilyDropdown`、`settingsRowClasses.ts` |
| 11. Agent 资源 | 每个 CLI 独立分区，只读显示 MCP 名称、类型或命令及作用域；Skills 名称、描述、作用域、npx skills 管理标记和来源仓库。读取错误显示在所属分区，长清单虚拟化 | `components/settings/settingsRowClasses.ts`、`McpServersSection.tsx` |

配置位置、项目资源边界、全局及项目锁文件、官方资料和 Pi 安装包依据见 [Agent 配置清单](../dev-rules/agent-configuration-inventory.md)。项目锁已核对为 `<项目>/skills-lock.json`，全局锁为 `~/.agents/.skill-lock.json`，并支持 `XDG_STATE_HOME`。

## 先失败、后修复

| 问题 | 观察到的失败 | 修复后的断言 |
|---|---|---|
| Codex App 图片 | `localImage` 被转为文件文字 | 完整 App 封装生成图片；缺失图片保留图片错误身份 |
| 不完整行数 | 空或局部 diff 得到零行统计 | 片段保持未知，完整 unified hunk 才计数；hunk 内形似文件头的内容正常计数 |
| 完成态工作组 | 助手进度散落，运行态展开状态沿用到完成态 | 外层组包含进度和动作，完成态使用独立展开键 |
| 中止前的进度 | 最后一次动作前的助手进度被视为最终回复 | 中止前的文字与尾部动作一起收起 |
| 独立图片消息 | 图片在压缩标记之后出现且失去时间 | 图片留在原边界之前，保留时间；缺失图片仍进入标题上下文 |
| 文件链接分类 | 带端口的 HTTPS 被当作本地路径 | 网页、自定义协议与文件行号分别识别 |
| 归档快捷操作 | 归档行出现置顶按钮 | 归档行保留生成标题和更多 |
| 设置短清单 | 估算行高留下 69 / 46 / 23px 空白 | 容器使用实际虚拟高度，三种长度的额外空间均为 0 |
| 下拉焦点 | 焦点移出后旧弹层仍显示 | 焦点离开触发器和弹层即关闭 |

逻辑回归位于 `items.test.ts`、`fileLinks.test.ts`、`sidebarModel.test.ts`、`Sidebar.test.tsx`，以及 Rust 的 `codex`、`attachments`、`titles`、`writers`、`agent_resources` 和 `local_files` 测试。CLI 清单测试全部使用临时目录，覆盖来源、YAML 描述、错误隔离、敏感字段过滤、符号链接去重和配置字节保持原样。

## 原生替身验收

调试包为 `Tandem Session Audit` / `com.mingzaily.tandem.session-audit`。`TANDEM_DRIVE_DATA_DIR` 隔离应用数据；`TANDEM_DRIVE_RESOURCE_HOME`、三种 CLI 的配置根目录和 `ZDOTDIR` 隔离原生任务、资源与 CLI 替身。替身发送前校验临时项目目录，没有真实模型请求。所有交互通过调试页面脚本完成，截图只读取目标窗口。

- 同轮包含中间助手文字、动作与最终回复，默认仅显示外层标题和最终回复；展开后内层动作各自收起。切换任务后展开状态保持。
- 替身实际输出 8 条 Read 活动，默认显示第 4～8 条，展开显示 1～8 条，结束后恢复完成态。
- 在临时 Codex 目录实际持有 flock，空闲提示出现；释放锁后保持原任务，提示消失，发送按钮自动恢复。输入框继续允许编辑草稿，锁限制发送。
- 分组与排序通过悬停子菜单修改后写入 TOML；项目取消置顶立即恢复普通顺序，重开应用后分组、排序和项目置顶保持。
- 本地文件默认打开与访达定位均到达原生命令，参数分别为 `open -- <完整路径>`、`open -R -- <完整路径>`。验收用替身 `open` 记录参数。复制路径和终端续接命令通过页面替身断言，系统剪贴板保持原样。
- 三 CLI 的 MCP / Skills 分区均显示全局、项目及 npx 来源；Pi 的损坏项目配置只在 Pi MCP 分区显示路径及 JSON 行列，其他资源继续显示。
- 720px 窗口的文档宽度仍为 720px，320px 下拉位于窗口内；窄布局允许标签换行。

页面断言见 [page-assertions.json](assets/session-sidebar-2026-11-08/page-assertions.json)，系统打开参数见 [native-open.jsonl](assets/session-sidebar-2026-11-08/native-open.jsonl)。红、绿断言分别保留，用于说明已修复的设置布局与焦点问题。

## 目标窗口截图

下列最终截图均逐张查看，并对照上表 Cindy 源码的结构、尺寸、间距、图标和状态规则。测试中的主题切换使用配置命令，菜单、焦点和输入使用页面脚本。

| 状态 | 浅色 | 深色 |
|---|---|---|
| 会话、文件链接与无行数卡片 | [查看](assets/session-sidebar-2026-11-08/conversation-light.jpg) | [查看](assets/session-sidebar-2026-11-08/conversation-dark.jpg) |
| 完成态外层展开、内层收起 | [查看](assets/session-sidebar-2026-11-08/work-expanded-light.jpg) | [查看](assets/session-sidebar-2026-11-08/work-expanded-dark.jpg) |
| 运行中最近 5 条 | [查看](assets/session-sidebar-2026-11-08/work-running-five-light.jpg) | [查看](assets/session-sidebar-2026-11-08/work-running-five-dark.jpg) |
| 运行中全部 8 条 | [查看](assets/session-sidebar-2026-11-08/work-running-all-light.jpg) | [查看](assets/session-sidebar-2026-11-08/work-running-all-dark.jpg) |
| 本地文件右键菜单 | [查看](assets/session-sidebar-2026-11-08/file-menu-light.jpg) | [查看](assets/session-sidebar-2026-11-08/file-menu-dark.jpg) |
| 本机图片及缺失占位 | [查看](assets/session-sidebar-2026-11-08/images-light.jpg) | [查看](assets/session-sidebar-2026-11-08/images-dark.jpg) |
| 空闲任务写锁 | [查看](assets/session-sidebar-2026-11-08/writer-lock-light.jpg) | [查看](assets/session-sidebar-2026-11-08/writer-lock-dark.jpg) |
| 任务菜单及标题栏按下态 | [查看](assets/session-sidebar-2026-11-08/task-menu-light.jpg) | [查看](assets/session-sidebar-2026-11-08/task-menu-dark.jpg) |
| 项目右键悬停二级菜单 | [查看](assets/session-sidebar-2026-11-08/project-submenu-light.jpg) | [查看](assets/session-sidebar-2026-11-08/project-submenu-dark.jpg) |
| 筛选排序二级菜单 | [查看](assets/session-sidebar-2026-11-08/filter-submenu-light.jpg) | [查看](assets/session-sidebar-2026-11-08/filter-submenu-dark.jpg) |
| 标题栏快捷入口与 Tip | [查看](assets/session-sidebar-2026-11-08/header-tip-light.jpg) | [查看](assets/session-sidebar-2026-11-08/header-tip-dark.jpg) |
| 归档行快捷操作 | [查看](assets/session-sidebar-2026-11-08/archived-actions-light.jpg) | [查看](assets/session-sidebar-2026-11-08/archived-actions-dark.jpg) |
| 外观胶囊下拉与开关 | [查看](assets/session-sidebar-2026-11-08/appearance-dropdown-light.jpg) | [查看](assets/session-sidebar-2026-11-08/appearance-dropdown-dark.jpg) |
| 720px 外观窗口 | [查看](assets/session-sidebar-2026-11-08/appearance-narrow-light.jpg) | [查看](assets/session-sidebar-2026-11-08/appearance-narrow-dark.jpg) |
| Claude Code 资源 | [查看](assets/session-sidebar-2026-11-08/agents-claude-light.jpg) | [查看](assets/session-sidebar-2026-11-08/agents-claude-dark.jpg) |
| Codex 资源 | [查看](assets/session-sidebar-2026-11-08/agents-codex-light.jpg) | [查看](assets/session-sidebar-2026-11-08/agents-codex-dark.jpg) |
| Pi 资源与读取失败 | [查看](assets/session-sidebar-2026-11-08/agents-pi-light.jpg) | [查看](assets/session-sidebar-2026-11-08/agents-pi-dark.jpg) |

另保留[锁释放后的深色窗口](assets/session-sidebar-2026-11-08/writer-recovered-dark.jpg)，对应同任务自动恢复断言。

## 两轮自审

**业务逻辑：** 核对原生消息身份、单写入锁、文件打开边界、完整行数判定、轮次结束和中止、置顶及排序、配置来源和只读契约。修复了图片独立边界与标题上下文、形似文件头的 hunk 内容、中止时助手进度和归档快捷置顶。当前范围内无已知阻塞问题。

**代码设计：** 文件链接分类、任务路径解析、侧栏排序和 CLI 资源读取各自集中；筛选与项目菜单复用同一分组排序菜单，主题和语言共用下拉；虚拟列表和延迟加载沿用现有工程能力。图片读取只存在于原生历史解析器，页面取得受限结果；配置清单只返回展示字段，错误按分区保留。临时入口受调试编译条件约束。

## 检查、release 与性能

| 命令 | 结果 |
|---|---|
| `cd desktop && pnpm typecheck` | 通过 |
| `cd desktop && pnpm test` | 179 项、33 个文件通过 |
| `cd desktop/src-tauri && cargo test` | 203 项通过；1 项原有大图片队列性能测试默认忽略 |
| `cd desktop/src-tauri && cargo clippy --all-targets -- -D warnings` | 通过 |
| `cd desktop && pnpm tauri build --bundles app` | 通过 |
| `git diff --check` | 通过 |

命令结果保存在 [validation.txt](assets/session-sidebar-2026-11-08/validation.txt)。正式产物为 `desktop/src-tauri/target/release/bundle/macos/Tandem.app`，约 5.69 MiB，已打开并核对正常应用标识、真实任务和独立进程；正式进程使用常规环境，测试路径覆盖为空，二进制中也没有页面脚本驱动入口。

打开新版前，旧窗口没有运行操作、CLI 子进程、待发送条目或草稿，已关闭空闲旧窗口。最终保留正式 release 进程 66401。正式 `config.toml` 和 `state.json` 在打开前后 SHA-256 一致。

最后一次启动从 main 进入到 `TANDEM_READY` 为 634ms，首次本机列表为 19ms；空闲主进程 RSS 单次抽样 88.83 MiB，未计入 WebKit 和 CLI 子进程。前端入口 446.25 kB / gzip 134.62 kB，按需消息块 363.46 kB / gzip 110.69 kB。Agent 清单进入设置分区后才读取，清单组件独立按需加载。启动原始记录见 [release-startup.txt](assets/session-sidebar-2026-11-08/release-startup.txt)，产物与状态核对见 [release-check.json](assets/session-sidebar-2026-11-08/release-check.json)。

## 哈希与清理

四份主要 CLI 配置 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.pi/agent/settings.json`、`~/.pi/agent/models.json` 的 SHA-256 与开始时一致；Pi MCP 文件的缺失状态、全局 npx skills 锁也保持一致。临时配置共 7 份，读取前后哈希全部一致，见 [fixture-hash-check.json](assets/session-sidebar-2026-11-08/fixture-hash-check.json)。

`~/.claude.json` 同时保存配置与运行状态，本批期间其整文件哈希发生变化。与匹配起始哈希的自动备份对比，变化包括 `cachedUsageUtilization`、`numStartups`，以及项目的 `lastDuration`、`lastFpsAverage`、`lastFpsLow1Pct`、`lastSessionId`、`lastStartTime`。机器同时存在更早启动的独立 Claude 进程，正式应用的 CLI 元数据初始化也会启动 CLI。全局和各项目 MCP 定义在比较链中保持一致。记录只保存字段名和摘要，原文件保持由 CLI 管理。完整哈希结论见 [cli-hash-check.json](assets/session-sidebar-2026-11-08/cli-hash-check.json)，运行字段与 MCP 对比见 [claude-runtime-diff.json](assets/session-sidebar-2026-11-08/claude-runtime-diff.json)。

测试应用、替身 CLI、持锁进程、临时原生任务、项目、脚本、配置与数据目录均已结束并清理；独立调试包、WebKit 和缓存目录也已删除。保留本批要求的截图和验收记录，以及用户要求打开的正式 release。清理核对见 [cleanup.json](assets/session-sidebar-2026-11-08/cleanup.json)。相关规则、配置位置文档、文档索引和 repo-map 已同步。

## 验证边界

单写入提示用真实 flock 和替身任务验证，保持用户 ChatGPT 任务原样；真实模型网络没有调用。系统打开参数已核对，用户的默认程序关联和访达实际窗口没有联动测试。清单表示静态配置中的资源，插件包、扩展动态注册、托管配置和额外启动参数由各 CLI 自己管理，资源连接与启用状态由 CLI 判断。长清单使用虚拟列表，本批没有进行数千个技能或动作的压力测试。

启动和内存采用本机单次抽样，缺少本批修改前的同条件基线，数据只说明观测结果。默认忽略的大图片队列性能专项沿用现有规则。

## 复审修正（Claude）

- 标题栏“…”和侧栏筛选按钮在菜单打开时再次点击，会先因外部按下关闭、再由点击重新打开。现在这两个按钮按下时不再触发外部关闭，再点一次即关闭。
- 本地文件链接指向 `.app`、`.command`、`.terminal`、`.pkg`、脚本等打开即运行的文件时，改为在访达中显示，不直接打开。链接来自模型输出，不能让一次点击启动程序。
- 截图仍是复审前的版本：任务行悬停按钮中间那个现在是生成标题，不再是重命名。
