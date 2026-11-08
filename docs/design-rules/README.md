# 设计规则

> **状态**：权威
> **读取时机**：新增或修改界面、组件、布局、样式、动效或文案之前

Tandem 的目标是**尽量复刻 Cindy 的界面**。`upstream/` 是原样复制的规范，本文件说明它在 Tandem 里怎么用，两者冲突时以本文件为准。

## 复刻方法

1. 先在原版代码里找到对应组件，照搬它的几何、token、字号和交互，不要凭规范文字猜。
2. 原版代码在 `docs/reference/repos/cindy/apps/desktop/src/renderer/`。这份仓库不上传，新机器上的取法见 [参考资料](../reference/README.md)。
3. 改完要看实际截图，不能只看代码。

已经复刻的组件和原版对照：

| Tandem | 原版 |
|---|---|
| `Sidebar.tsx` | `components/sidebar/SidebarTopNav.tsx`、`features/cc-agent/sidebar/SessionItem.tsx`、`sections/ProjectNode.tsx` |
| `MessageStream.tsx` 工作组 | `components/chat/WorkGroupBlock.tsx`、`packages/maker-shared/src/workRunGrouping.ts` |
| `MessageStream.tsx` 工具行 | `components/chat/AgentActionRow.tsx`、`activityRowChrome.ts` |
| `MessageStream.tsx` 用户气泡 | `components/chat/UserMessage.tsx` |
| `Composer.tsx` | `components/new-chat/ChatInput.tsx`、`SendButton.tsx`：原版普通对话最小 86px、新建页 140px；Tandem 按用户要求将续聊卡片调为最小 112px，新建页采用 140px。队列放在编辑区之外，共享外边框；多行继续自动增高 |
| 输入光标与焦点 | `styles/globals.css` 的 `--caret-accent`，以及 `composerBlankPointerFocus.ts`、`useComposerSendFocusRestore.ts`：蓝色原生光标；点击编辑区空白保留选区，控件与 Portal 使用自身焦点。发送后按焦点归属恢复输入，期间主动转移焦点时保持新位置 |
| `ConversationLayout.tsx` | `features/cc-agent/CCAgentSessionView.tsx` 的输入区 overlay：上沿 32px 渐变、下方实色区、底部 20px 留白；实测输入区高度传给消息流，状态、队列和多行输入改变高度时同步更新，贴底的最后一行保留完整显示空间 |
| `PendingQueuePanel.tsx` | `components/new-chat/PendingQueuePanel.tsx` 与 `ChatInput.tsx` 的无标题栏合并骨架：12px 外框、8px 行圆角、13px 正文、1.25 行高、20px 圆形操作、196px 列表上限和 4px 滚动条。按用户确认适配为最小 32px 行、18px 缩略图、上下各 6px。正文从卡片内 24px 起排，把手位于文字左侧的独立留白；列表水平 4px 内距让起点独立于系统滚动槽宽，单侧 stable 滚动槽容纳长列表；拖动使用实测行位置 |
| 队列与输入区协调 | 默认隐藏操作；进入队列区时所有行操作浅显，当前指向或聚焦行突出；68px 固定占位与透明度切换保持布局。附件信息紧跟文字；“还有 N 条”作为列表末行，和队列及输入正文统一到 24px。内部只保留队列与输入框之间一条线。排队提交为 ListPlus，普通发送为 ArrowUp，编辑集中取消/保存并保留原草稿。移到队首只调整待发送顺序 |
| `ComposerStatusRow.tsx` | 对照 `CCAgentSessionView.tsx` 的运行状态行：固定放在整张输入卡片上方，最小 32px、13px/medium、14px 图标、左右 8px、下距 6px。运行时左侧 Sparkles 与活动文字、右侧 24px 耗时/Token 入口；队列暂停时左侧 Pause 与“任务已停止，队列暂停”、右侧 24px 描边“继续发送”。两态共用布局，图标与文字按 flex 中心对齐；原版 Sparkles 的上移 1px 在 Tandem 中移除。暂停保持静态，运行状态按活动呼吸。Cindy 原版的暂停入口位于队列底栏，此位置属于用户确认的适配 |
| `RemoteAccessNotice.tsx` | 对照 `features/remote-device/ControlledBanner.tsx`：28px 高、12px 文字、6px 呼吸点，胶囊位于输入区上方中间；收起后在耗时和 token 入口前保留 20px 状态点。单设备显示名称并确认撤销，多设备进入远程设置逐台管理。Tandem 以已完成加密握手的手机连接为准，撤销后重新配对；收起状态按任务保存在内存，新连接到来时展开。撤销确认由页面持有，任务状态变化时保留；窄输入区让胶囊单独占一行，与运行状态和统计分开 |
| `MessageStream.tsx` 中断提示 | `components/chat/InterruptedTurnBanner.tsx` 的 CirclePause，使用 `--status-paused`，随所属轮次保留；输入区暂停状态使用轻量 Pause 与 `--status-bar-accent` |
| `FileChangeSummary.tsx` | `components/chat/TurnChangesCard.tsx`：变更卡片跟随每轮结果留在消息流中，12px 圆角、14px 标题、36px 文件行，默认展示 3 个文件，再展开更多。原版标题区为 64px；按用户确认压为最小 48px，水平 12px、垂直 6px 内距，28px 图标盒、16px FileDiff；有行数统计时自然增高。采用原版表面、边框与增删颜色 token；Tandem 使用只读记录，文件名优先、目录次要，长清单虚拟化，完整路径通过悬停查看，缺少完整行数时保留文件数。消息流使用对称滚动槽，与输入区共用中轴 |
| 任务菜单的“生成标题”与标题栏 | 任务菜单使用 lucide Sparkles 图标，生成期间禁用重复操作；标题栏显示任务标题、CLI 图标、在访达中打开项目、复制终端续接命令和任务菜单；图标按钮使用底部 Tip，任务菜单打开时保留按下样式。CLI 图标通过悬停与可访问名称说明类型。生成和原生保存参考 pi-web 0.15.0；Sparkles 用于生成标题、思考和运行状态，自动审批使用 ShieldCheck |
| `EffortSlider.tsx` | `components/ui/effort-slider.tsx`：38px 操作区、12px 轨道、21px 滑块，档位使用绝对颜色 token；指针松开提交、取消保留原值，支持方向键、Home、End；单一档位只显示文字 |
| `ModelSelect`、`ModelPickerPanel.tsx` | `components/new-chat/ModelSelector.tsx`、`UnifiedModelPanel.tsx` 与 `components/ui/morph-popover.tsx`：输入区模型菜单向上展开，列表区域采用 428px，按上方可用空间压缩并内部滚动；移除主列表底部的常驻强度滑杆。CLI 默认模型加“默认”文字标签，标签仅作说明；当前选中项保持行高亮 |
| `ModelConfigFlyout.tsx` | 对照 `UnifiedFlyoutHost.tsx`、`ModelConfigFlyout.tsx`、`useUnifiedRowActions.ts` 和 `effort-slider.tsx`：宽 264px、间隔 4px、内距 14px/底部 12px；指针移动预览，松手或键盘调档即应用，恢复默认即清除覆盖。关闭浮层保留已提交值；指针取消撤销手势预览。Tandem 更新单份发送偏好，调另一个模型时一同选中该模型，已入队条目保留原快照。Esc 分层关闭，不增加收藏 |

## 工具名称与详情

运行行沿用 Cindy 的“工具名 运行中…”；长名称单行省略，悬停查看全名。等待确认优先，工具结束后切换到当前的思考或回复状态；并行工具乱序完成时显示仍在运行的调用。行高、图标、活动呼吸和右侧耗时/Token 沿用共用状态行。

工作记录里的 MCP 主行按 `toolUseDescriptor.ts`、`actionPresentation.ts` 和 `AgentActionRow.tsx` 显示“调用 服务器 · 可读工具名”。服务器标识保持原值，工具部分的下划线转空格，主文字 14px/medium。参数摘要进入悬停说明，原始输入和结果通过展开查看。通用未知工具主行保留原名，参数从详情读取。

## 不复刻的内容

Cindy 的名称、Logo、角色形象和宣传图不在 Apache-2.0 许可范围内。应用图标用 [`docs/brand/tandem-icon.svg`](../brand/tandem-icon.svg)，标记用 `tandem-mark.svg`。

菜单栏使用 [`tandem-tray.svg`](../brand/tandem-tray.svg) 生成的 `desktop/src-tauri/icons/tray-template.png`：44×36 像素的横向透明画布，对应菜单栏的 22×18pt 显示尺寸，双环实际高度约 13pt、宽度约 20pt。只有双环为不透明区域，交叉处保留加宽的透明留缝。macOS 按模板图标的透明通道着色，跟随菜单栏外观和选中状态。更新源文件后，在 macOS 的仓库根目录生成 PNG；Tauri 先等比居中生成方形图，再裁掉上下的透明留白：

```bash
tandem_tray_dir=$(mktemp -d)
pnpm --dir desktop tauri icon ../docs/brand/tandem-tray.svg --fit contain --png 44 --output "$tandem_tray_dir"
sips --cropToHeightWidth 36 44 "$tandem_tray_dir/44x44.png" --out desktop/src-tauri/icons/tray-template.png
rm "$tandem_tray_dir/44x44.png"
rmdir "$tandem_tray_dir"
```

## `upstream/DESIGN.md` 的适用范围

| 章节 | 处理方式 |
|---|---|
| §1–§8 视觉语言、颜色、排版、组件、布局、层级、窗口 | 适用。§1.1 的订阅与额度卡片不适用 |
| §9 Agent Prompt Guide | 适用 |
| §10 主题与 Token | 只适用默认浅色和深色；内置主题切换和用户主题暂不做 |
| §11 文案 | 适用。品牌名换成 Tandem，语言只写 `zh-CN` 和 `en` |
| §13 待定项、§14 交互约定、流式正文 | 适用 |
| §15 CINDY 皮肤族 | **不适用** |
| §16 登录链路 | **不适用**，Tandem 没有账号登录 |

其他文件：

- `upstream/design-decision-log.md`：参考，用来了解某条规则的来由。
- `upstream/token-decision-table.md`：参考，内容以登录链路为主。
- `upstream/design-governance.md`：只参考 Token 分层和颜色纪律。PR 流程、证据合同和 CI 门禁不适用。

规范里的 `apps/desktop/...`、`packages/...` 路径指 Cindy 的代码。引用的 `assets/` 图片和手柄、iOS 等专题文档没有复制，相关链接会失效。Cindy 字样是来源说明，不要带进界面。

## 菜单栏面板

标题行右侧提供手动刷新，复用右下角按钮样式：28px 点击区、14px 中性灰 RefreshCw 图标、1.8px 线宽，静置时透明底，悬停提示“刷新”。读取期间旋转并禁用重复点击，减少动态效果时保持静态。刷新覆盖额度、任务列表和原生写入者状态，面板保持打开；各数据源成功后更新，有效的 0% 显示为 0% 和空管，读取失败时保留该源的已有数据并显示原因。

面板按实际原生窗口高度布局，标题和底部操作固定，中间内容区滚动。独立测量内容的自然高度，让窗口随任务增减伸缩，上限 560px；窗口变矮时滚动区域随之缩小，最后一条任务和底部按钮均可完整查看。

## 设置页

几何和 token 照搬原版的 `components/settings/`：左侧导航 260px，内容最宽 920px，卡片用 `--settings-theme-card-*`。分页只放已经能用的选项，没做的功能不放占位。用户可见的文字不提 Cindy。

操作按作用范围放置：添加项目、配对新设备放在分组标题右侧；加入项目、更改目录、移除和撤销放在对应行右侧。“中转服务”的保存操作固定放在标题右侧，未修改时禁用，有编辑内容时显示“还原更改”；卡片只放地址、令牌和操作错误，连接状态放在“允许手机访问”的说明中。提交失败保留输入。远程访问开关使用已保存的配置，开启访问和保存表单分别提交。

设置动作统一使用 `SettingsButton.tsx`，对应原版 `components/ui/button.tsx`：32px 高、13px/500 字号、胶囊圆角。常规操作用描边按钮，表单提交用中性灰底，辅助操作和行内图标用安静样式，撤销设备用危险色。悬停和按下颜色由基础表面色递进，加载时保留文字占位及可访问名称；禁用按钮使用普通指针。目录行布局参考 `DialogueDirectorySection.tsx`。

## Token

- `desktop/design/tokens/tokens.css`：字号、间距、圆角、动效等基础 token。
- `desktop/design/tokens/colors.css`：基础颜色。浅色写在 `:root`，深色写在 `.dark`。
- `desktop/design/tokens/theme.css`：覆盖 `colors.css` 的暖色主题值，界面实际看到的颜色以它为准。
- `desktop/design/tokens/tailwind.generated.ts`：Tailwind 的字号、间距、圆角和字重映射。

这些文件已归本仓库维护，要改 token 就直接改，并同时改好浅色和深色。来源见 `SOURCE.md`。

写法规则，由 `desktop/src/lib/designTokens.test.ts` 检查：

- 颜色和动效一律用 token，不写裸值。
- 只能引用存在的 token。
- 部分 token 存的是 HSL 三元组（如 `--sidebar`），要写成 `hsl(var(--sidebar))`。直接写 `var(--sidebar)` 是非法颜色，边框会退成黑色。
- 菜单和配置浮层使用 `--shadow-menu`，Tailwind 写为 `shadow-[shadow:var(--shadow-menu)]`。带类型提示才能生成 box-shadow，普通 `shadow-[var(...)]` 会被解释成颜色。

## 指针与交互反馈

模型列表中，选择按钮与配置按钮是同一列表条目的平级控件。选择按钮表达选中状态；方向键左键和右键保留配置入口，Esc 关闭配置后焦点回到发起控件。

确认卡片提交期间保留并禁用操作。失败后显示原因、恢复操作并保留用户输入；成功或请求已结束时移除卡片。

按钮、链接、可选择项和开关使用手形；文字输入使用 I 形；拖动把手使用 grab/grabbing；强度滑块使用水平调整指针；禁用控件使用普通箭头。悬停与按下沿用各组件的表面色和文字色变化，键盘操作保留可见焦点环。

## 会话、侧栏和外观

Markdown 对照 `MarkdownRenderer.tsx` 的 `shouldRenderCodeReferenceLabel` 和 `useFileChipContextMenu.tsx`：本地链接标签是路径、文件名或带行号的文件引用时使用文件块；说明文字使用下划线链接。左键通过系统默认程序打开，右键提供打开、在访达中显示、复制路径。网页链接继续使用浏览器。用户消息中不可用的本机图片对照 `ImageMissingPlaceholder.tsx`，使用最小 140px 高、12px 圆角的虚线占位，居中显示 32px ImageOff 和文字；文件缺失时显示“图片已不在本机”。

工作过程对照 `WorkGroupBlock.tsx`：运行中的动作段默认展示最近 5 条活动，超过 5 条时组头切换到全部；5 条以内的组头保持静态。中间助手文字在运行期间持续可见，完成后与动作段一起放入默认收起的外层组，最后回复留在外面。外层标题为“已处理 <时长>”，内层动作为“已工作 <时长>”，缺少时间时为“工作过程”。外层、内层、思考与工具详情按任务独立记住展开状态，直到应用退出。长动作清单采用 420px 的虚拟滚动区域。

侧栏对照 `SidebarFilterPopover.tsx`、`SessionItem.tsx`、`useSidebarFilter.ts` 和 `mainListModel.ts`：项目内可按 Claude Code / Codex / Pi 建二级组；按最近活动、CLI 类型或优先级排序：类型同档内按时间倒序；优先级为等你回答 > 完成未读 > 运行中 > 其他，同档按时间，正在看的任务保持打开时的档位，离开完成未读的任务时它排到“其他”档最前（`advanceHold`）。等你回答、完成未读用 8px 圆点代替时间（`SidebarRightStatusIndicator`），选中行用选中前景色。筛选按钮以点击打开，项目右键菜单中的分组、排序以悬停展开子菜单。置顶任务位于最前；项目列表中“对话”固定在第一位，置顶项目紧随其后，再到其余项目。任务行悬停提供 20px 的置顶、生成标题、更多按钮，图标 14px、间距 2px；菜单打开期间保持被操作行的选中样式和“…”高亮。

设置主题与显示语言共用胶囊下拉，对照 `AppearanceSection.tsx` 的 `FamilyDropdown`：36px 高、320px 宽、14px 箭头，弹层 12px 圆角、8px 内距、36px 选项行。二选一的布尔设置使用切换开关。Agent 分区对照 `settingsRowClasses.ts`、`McpServersSection.tsx` 的设置行，按名称、说明、来源排布，只读展示 MCP 与 Skills。

最后一条消息可编辑时，铅笔按钮挂在气泡外侧、与气泡顶部对齐（对照 `BubbleHoverToolbar` 和 `MessageActionBar` 的 24px 圆形按钮），悬停或键盘焦点进入才显示，不占列表高度。编辑框对照 `UserMessageEditBox.tsx`：整列宽的气泡，左下一行提示，右侧取消（secondary）和发送（cta）两个 28px 胶囊按钮。
