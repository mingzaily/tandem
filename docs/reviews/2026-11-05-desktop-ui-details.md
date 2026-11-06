# 2026-11-05 下午至晚间：桌面端细节与样式复审材料

> **状态：参考。** 本文已按 2026-11-06 review 后的确认更新为当前实现，供 Claude 复审。权威规则继续以产品、设计和开发规则为准；历史截图与当批测试数字保留在第 14 节及对应验收记录。
>
> **当前调整：** 队列保留 Cindy 无标题栏骨架，采用用户确认的 32px 行高、18px 缩略图、24px 文字对齐、全队列浅显操作和列表末行折叠。模型强度提交后立即应用，生成标题只保留任务菜单入口。详见第 3、7、8、17 节；最终 review 的队列可靠性、图片存储、确认卡片和模型按钮结构见第 19 节。
>
> **代码快照：** main 分支的未提交工作区。多个任务共用目录，本文按桌面端文件和功能界定范围。

## 1. 阅读方式与范围

先读 [AGENTS.md](../../AGENTS.md)、[设计规则](../design-rules/README.md)、[Desktop 开发](../dev-rules/desktop-development.md)、[架构不变量](../dev-rules/architecture-invariants.md) 和 [原生会话](../dev-rules/native-sessions.md)，再对照本文的代码入口和截图。

本文中的尺寸均为 CSS 像素。Retina 截图的图片像素与 CSS 像素存在倍率关系。表内“最小高度”“可用空间上限”和“实测高度”分别标明，复审时按相同页面状态比较。

| 用户提出的问题 | 当前落地结果 |
|---|---|
| 运行时还能继续发消息 | Rust 持久化待发送队列，正常结束自动续发，停止、错误、重启后暂停 |
| 队列与提示区混在一起、操作难发现 | 无标题栏；32px 行、24px 文字起点；进入队列时全体操作浅显，折叠置于列表末行，暂停独立呈现，见第 3、17 节 |
| 队列与 tip 区整体协调 | 入队说明已移除；编辑只有一个取消入口；保存使用文字按钮；工具栏与底栏对齐，见第 16、17 节 |
| “已中断”颜色 | CirclePause 图标与琥珀色，随所属轮次保留；输入区暂停采用轻量 Pause |
| “XX 个文件已更改” | 当前跟随每轮结果保留在消息流中，使用 Cindy 的卡片结构；标题区最小 48px，见顶部后续记录 |
| 输入区上方正文被生硬切断 | 消息流延伸到输入区后方，32px 渐隐，动态测量底部留白 |
| 没光标、输入框偏矮 | 蓝色原生光标和焦点恢复；续聊卡片最小 112px，新建卡片最小 140px |
| Codex 档位缺失、Claude/Pi 配置显示不准 | 读取每个模型的实际能力与默认值；保留错误、缓存和刷新状态 |
| 模型菜单向下、默认模型不明确 | 模型菜单固定向上；三种 CLI 的原生默认模型使用“默认”文字标记 |
| 模型菜单高度与配置区不合理 | 428px 列表区域随空间收缩；强度配置移到 264px 独立浮层 |
| 某个会话生成标题，并写回标题 | 独立生成请求，再通过 CLI 原生改名协议保存，原对话消息保持原样 |
| Codex App 正常，Tandem 显示附件封装文字 | 完整识别 Codex App 附件封装，展示正文、图片和文件标签 |
| 复制终端续接命令缺少 cd | 复制内容包含实际任务目录及安全引用后的续接命令 |

置顶/归档行内快捷按钮、侧栏加载图标替换、Agent 的 Skills/MCP 页面仍属于讨论项，见第 10 节。同日设置页的独立批次见第 11 节。

## 2. 输入区的最终层次

“tip 区”在代码中有不同职责，最终布局按下面的顺序组织：

| 从上到下 | 内容与职责 |
|---|---|
| 消息流 | 用户消息、工作记录、助手结果、每轮文件变更卡片、已中断标记 |
| 32px 过渡带 | 消息正文滚动到输入区后方时渐隐 |
| 任务状态与交互 | 外部写入提示、错误、权限确认或提问，按实际状态出现；运行和队列暂停共用卡片上方的 32px 状态行 |
| 合并卡片的队列区 | 待发送行、末行折叠；状态位于整张卡片上方 |
| 卡片内部细分隔线 | 区分待发送列表与正在编辑的消息 |
| 合并卡片的编辑区 | 编辑说明、附件、正文、错误、权限/模型/发送工具栏 |
| 卡片外底栏 | 左侧目录，右侧用量和上下文；间隔 8px，最小行高 24px |
| 窗口下沿 | 20px 留白 |

队列与输入框共享一个外边框、一个 12px 外圆角和焦点边框。目录、用量、上下文继续用轻量的次要信息行，避免给每块信息再加一张卡片。运行状态行保留自己的活动反馈。

代码：[App.tsx](../../desktop/src/App.tsx)、[ConversationLayout.tsx](../../desktop/src/components/ConversationLayout.tsx)、[Composer.tsx](../../desktop/src/components/Composer.tsx)、[ComposerControls.tsx](../../desktop/src/components/ComposerControls.tsx) 中的 ComposerFooter。

## 3. 待发送队列

### 3.1 最终外观

| 项目 | 当前值或规则 |
|---|---|
| 骨架 | Cindy 的合并外框、12px 圆角、无标题栏；队列与输入框之间一条细线 |
| 密度 | 默认 32px 行、13px 正文、1.25 行高、8px 行圆角；列表上下各 6px |
| 统一起点 | 队列文字、附件行正文、“还有 N 条”和输入正文均从卡片内 24px 起排；拖动把手位于文字左侧的独立留白。列表水平 4px 内距，行正文再进 20px，起点独立于系统滚动槽宽 |
| 行操作 | 20px 圆形按钮、68px 固定操作占位；默认隐藏，进入队列时全体浅显，当前指向或聚焦行突出。显示切换只改透明度 |
| 附件 | 18px 缩略图与数量紧跟文字，长正文省略；完整文本和附件名通过 title 查看 |
| 折叠 | 1–4 条全显；5 条起显示前 3 条；“还有 N 条”作为列表末行左对齐，展开后的“收起”也在末行 |
| 暂停 | 在整张卡片上方复用运行状态行：Pause + “任务已停止，队列暂停”，右侧 24px 轻描边“继续发送”。队列和输入区之间只有一条分隔线；运行时同一右侧位置显示耗时/Token |
| 长列表 | 最高 196px、虚拟化；4px 滚动条与单侧稳定滚动槽；拖动按实测行位置定位 |
| 编辑 | 编辑行保留高亮与等宽操作占位，正文在下方输入区修改 |

32px 行高、18px 缩略图、24px 起点、全队列浅显操作、末行折叠和卡片上方状态行是本次确认的有意适配。骨架、token、字号、圆形按钮继续对照 Cindy，当前队列按这些差异验收。普通箭头、手形、文本 I 形、拖动与滑块调整指针按控件语义呈现；禁用控件保留普通箭头。

### 3.2 排序与编辑

- 拖动使用 Pointer Events。移动达到 5px 时进入拖动态，接近滚动区上下沿时自动滚动；松开提交，Esc 或 pointercancel 取消。
- 拖动把手支持 ArrowUp、ArrowDown、Home、End。移动后保留行焦点，目标进入折叠区时展开列表，并通过 live region 告知新位置。
- “移到队首”只调整待发送次序。当前轮继续运行；真正的“插话/引导”尚未接入 CLI。
- 编辑复用下方输入框。队列行保留高亮，输入区显示“编辑待发送消息”，取消入口集中在输入区右上角。
- 保存使用“保存修改”文字胶囊，高 28px、字号 12px。编辑期间权限、模型和附件增删入口锁定，保留该条入队时的发送选项和附件。
- 保存或取消后恢复此前的草稿及其附件。取消后焦点回到草稿输入框；保存按发送时的焦点归属恢复。
- 保存请求期间禁用取消，避免两次操作交错。保存失败保留编辑内容并显示错误。

### 3.3 与界面绑定的后端契约

- 待发送消息由 Rust 按任务管理，写入 `~/.tandem/queues/`。发送前只属于 Tandem；CLI 原生会话在实际发送后记录消息。
- 条目保存正文、附件、模型、推理强度和权限。图片字节单独保存在 `queues/images/<taskId>/<attachmentId>`，JSON 只存引用；普通文件保存引用路径，后续读取依赖原文件存在。编辑与排序只写元数据，预览通过本地 `queue-image` 协议读取。
- 图片在元数据提交前落盘，接收确认或删除后回收无人引用的图片。空队列删除 JSON；队列只保存图片文件引用，捕获时的内存字节在落盘前保存为图片文件。`.corrupt` 对应图片保留供恢复。
- 领取准备时从同一份图片字节生成 CLI 内容和发送气泡的独立预览，接收确认后的图片清理保持气泡可读。队列列表继续按需读取本地图片文件。
- 草稿附件成功持久化入队后释放临时内存 ID；写入失败保留草稿附件。编辑时区分队列附件与原草稿附件的所有权。
- 当前轮的 CLI 进程完成并退出后自动领取下一条。停止、错误和带待发送消息的重启会暂停；“继续发送”显式恢复。
- 领取条目先保存为 `inFlight`，收到 CLI 的接收回执后才清除。启动失败、原生写入权被占用、拒收和接收前退出保留队首；`Started` 只表示生命周期开始。三个 CLI 的接收信号见[原生会话规则](../dev-rules/native-sessions.md#运行中插入的消息)。
- 重启时发送中条目回到队首并暂停，提示接收结果未知，由用户决定重发。单个坏队列保留为 `.corrupt` 并发出 `queue-error`，健康任务继续可用。
- 停止后清空队列，再直接发送时清除历史暂停和错误并落盘；运行中重新入队的消息在本轮成功后续发。
- “仍要发送”仅授权当时一次发送尝试，`ignoreExternalWriter` 始终省略于持久文件。读取旧队列、显式继续、失败重试和后续排队消息重新检查外部写入者。
- 拖动锁住整条队列的领取，编辑锁住当前条目。标题元数据写入与队列领取也互斥。
- 后端命令包含 list_queues、enqueue_turn、edit_queued_turn、remove_queued_turn、reorder_queued_turn、resume_queue、set_queue_lock；cancel_turn 同时处理停止与暂停。
- 菜单栏面板的进行中任务显示排队条数。本批保持手机端协议原样。

代码：[PendingQueuePanel.tsx](../../desktop/src/components/PendingQueuePanel.tsx)、[pendingQueue.ts](../../desktop/src/lib/pendingQueue.ts)、[queue.rs](../../desktop/src-tauri/src/queue.rs)、[attachments.rs](../../desktop/src-tauri/src/attachments.rs)、[commands.rs](../../desktop/src-tauri/src/commands.rs)、[TrayPanel.tsx](../../desktop/src/components/TrayPanel.tsx)。

## 4. 输入高度、光标、提示与底栏

### 4.1 高度和内距

| 项目 | Cindy 参考 | Tandem 最终结果 |
|---|---|---|
| 普通续聊卡片 | 最小 86px | 按用户要求改为最小 112px |
| 新建页卡片 | 最小 140px | 最小 140px |
| 编辑区实现 | 参考其布局 | 续聊主体最小 110px、新建主体最小 138px，加上下边框 2px |
| 正文输入 | 自动增高 | textarea 最小 52px，最高 240px，超过后内部滚动 |
| 正文及附件左右内距 | 对照输入组件并按用户把手间距反馈调整 | 24px |
| 工具栏与卡片外底栏左右内距 | 统一视觉起点 | 12px |

112/140px 指空闲输入卡片的最小高度。队列、附件、编辑标题、错误和多行正文会增加实际高度。最终验收在空闲状态实测到 112/140px；早期 94px 输入框截图已被后续批次替代。

### 4.2 光标和焦点

- 使用原生文本光标，通过 caret-accent token 显示蓝色；浅色和深色均检查。
- 点击编辑区空白时聚焦 textarea，保持原选区。按钮、可选择的文字和 Portal 内容继续使用自己的焦点。
- 通过发送按钮提交时保留输入焦点；提交完成后，只有焦点仍属于编辑器这次操作时才恢复光标。用户在等待期间选中其他控件时保留新焦点。
- Enter 发送与 Cmd+Enter 设置继续生效；组合输入确认候选词时保留草稿。

### 4.3 入队说明与底栏

排队模式以 ListPlus 提交图标和“加入待发送队列”的悬停提示及可访问名称表达动作。编辑器内保留正文空间；编辑队列消息时显示编辑状态说明和单一取消入口。普通发送为 ArrowUp，编辑提交为“保存修改”，停止为 Square。

目录、用量、上下文留在卡片外底栏，保持 12px 字号和原有次要信息 token。左侧显示工作目录或“对话”，右侧显示已有的额度与上下文信息。底栏与工具栏统一内距；目录名称可截断，完整路径通过 title 查看。最终批次整理了层次和对齐，用量计算与上下文含义沿用现有实现。

代码：[Composer.tsx](../../desktop/src/components/Composer.tsx)、[composerFocus.ts](../../desktop/src/lib/composerFocus.ts)、[ComposerControls.tsx](../../desktop/src/components/ComposerControls.tsx)、[app.css](../../desktop/src/styles/app.css)。

## 5. 消息过渡、中断、运行状态与文件摘要

### 5.1 正文到输入区的过渡

原来底部直接裁切正文，截图出现半行文字被截断。当前使用完整高度的消息滚动区与底部 overlay：上沿 32px 渐隐，下方为内容区实色，底部留白 20px。

ResizeObserver 测量整个底部区域，包含状态、权限/提问、队列、编辑器和底栏。高度变化在绘制前同步传给 MessageStream 的底部 padding 和 scroll padding。贴底时最后一行有完整空间；浏览历史时保持滚动位置。长确认卡片与长输入区可以在底部区域内部滚动。

输入主体最大宽度 934px，消息主体最大宽度 914px。常规布局输入区每侧 40px、消息区每侧 50px；主内容区宽度至 699px 以下时，分别为 10px 与 20px。新建页保留单独的页面布局。

### 5.2 中断与活动反馈

“已中断”使用 CirclePause 和 status-paused token；浅深色都由 warning-accent 与正文色组合得到琥珀色，跟随所属轮次保留。输入区的队列暂停改用轻量 Pause 与 status-bar-accent，位置始终在整张卡片上方。

运行状态继续使用 Sparkles 与随活动触发的呼吸效果，右侧显示耗时、输出 token。运行与暂停复用 ComposerStatusRow：32px 行、13px/medium 字号、14px 图标、左右 8px、下距 6px，右侧控件高 24px。图标与文字按 flex 中心对齐；移除原版 Sparkles 上移 1px 的偏移，也同步修正暂停图标。暂停保持静态，继续按钮恢复轻描边胶囊并对齐右侧操作。生成速度卡片为 Portal，支持悬停、点击固定、关闭和 Esc。

Cindy 的 CCAgentSessionView 将当前工具名称与 running 状态放在左侧，右侧保留耗时和 Token/速度。Tandem 已接入现有 CLI 工具事件，显示“工具名 运行中…”；长名称单行省略，悬停可看全名，状态行保持 32px。等待确认优先；并行工具乱序完成后显示仍在运行的调用，全部结束后回到思考，文字输出时显示回复。原版暂停入口仍在队列底栏，Tandem 的卡片上方共用状态行属于用户确认的适配。

工作记录里的 MCP 行按 Cindy 的 `toolUseDescriptor → actionPresentation → AgentActionRow` 链路：主行显示“调用 服务器 · 可读工具名”，工具部分的下划线转为空格，服务器标识保持原值。参数摘要进入悬停说明，点击展开显示原始输入与结果；参数不再拼入主行。具体实现与验证见第 20 节。

侧栏任务图标保留原有 task-running 呼吸动画。它与运行状态行的按活动触发动画分别实现；本批没有把侧栏统一改成循环 spinner。

### 5.3 文件编辑摘要

- 每轮结束后，文件变更卡片保留在该轮消息末尾；下一轮开始后历史卡片继续可见。
- 汇总该轮成功完成的显式编辑工具，按归一化路径去重，可信行数按各次补丁累计。
- 对照 Cindy TurnChangesCard：标题区最小 48px、图标盒 28px；默认预览 3 个文件，36px 文件行，展开上限 252px，长清单虚拟化。
- 文件名优先、目录次要；完整路径通过 title 查看。任一文件缺少完整行数时，卡片保留文件数。
- 完整差异与撤销继续作为后续能力。

代码：[FileChangeSummary.tsx](../../desktop/src/components/FileChangeSummary.tsx)、[fileChanges.ts](../../desktop/src/lib/fileChanges.ts)、[MessageStream.tsx](../../desktop/src/components/MessageStream.tsx)。

## 6. 三种 CLI 的模型、默认值与推理强度

### 6.1 数据来源和修正

| CLI | 已修正的规则 |
|---|---|
| Codex | 完整保留 supportedReasoningEfforts。本机 GPT-6.1-Sol 验证返回 low/medium/high/xhigh/max/ultra，原生默认 max；每个模型仍按自身元数据展示 |
| Claude Code | 模型切换成功后读取该模型的默认强度；切换失败保留默认值未知。初始化失败、格式错误和提前退出向界面报告，缓存清单继续可用 |
| Pi | 无会话临时进程逐个切换模型，读取 get_state 与 get_available_thinking_levels；保留 off 以及各提供方实际能力，切换使用 persist: false |

中文档位区分“低/中/高/超高/最高/极限”；其他协议值按实际能力显示，例如 minimal 为“极低”、none 为“不思考”、Pi off 为“关闭思考”。六档是本机模型的验证结果，模型能力由 CLI 返回值决定。

模型菜单显示加载、读取失败、缓存说明、空列表指引与刷新。新建任务保留三个 CLI 的浏览入口；已有任务保持所属 CLI。所选模型暂时离开清单时，触发器显示原模型标识。

### 6.2 默认模型

- Claude 使用 initialize 默认别名，Codex 使用 model/list.isDefault，Pi 使用 get_state.model。
- 默认别名与对应真实模型合成一行，加“默认”文字标签。当前选中状态另用行底色表达。
- 选择默认项保存 model: null，继续跟随 CLI 配置；选择其他模型保存 Tandem 的发送偏好。
- 默认 ID 尚未解析时保留“跟随 CLI 配置”入口。CLI 未报告默认值时保持未知，空 ID 的不同模型分别保留。
- 刷新后依据新元数据更新默认标记。此处只做默认模型概念，收藏功能保持未实现状态。

### 6.3 强度滑块

滑块按 Cindy 组件实现：38px 操作区、12px 轨道、21px 滑块，颜色使用档位 token。指针移动预览、松开提交；取消恢复原值，能力刷新取消旧手势。支持方向键、Home、End。单档模型显示文字，无思考能力的模型隐藏强度控件。

代码：[cli_info.rs](../../desktop/src-tauri/src/cli_info.rs)、[codex.rs](../../desktop/src-tauri/src/codex.rs)、[pi.rs](../../desktop/src-tauri/src/pi.rs)、[modelRows.ts](../../desktop/src/lib/modelRows.ts)、[modelEffort.ts](../../desktop/src/lib/modelEffort.ts)、[EffortSlider.tsx](../../desktop/src/components/EffortSlider.tsx)、[EffortSlider.css](../../desktop/src/components/EffortSlider.css)。

## 7. 模型选择器与独立配置浮层

### 7.1 通用弹层修复

早期模型列表被输入区滚动容器裁切，只剩强度滑杆。输入区相关菜单改为挂载到 document.body 的 Portal，并用视口坐标定位，跟随滚动和 resize，支持外部点击和 Esc 关闭。

模型菜单固定向上，按上方空间压缩高度。权限、项目、上下文等菜单继续按各自优先方向和可用空间适配。通用定位预留顶部 56px、底部 16px、水平边距 8px，普通菜单与入口间隔 6px。

菜单、模型配置和速度卡片采用原版 shadow-menu：浅色为 0 4px 16px rgba(0,0,0,.15)，深色为同尺寸 .5 透明度。修正 Tailwind 的歧义写法为 shadow-[shadow:var(--shadow-menu)]；旧写法被解释成阴影颜色，实际 computed box-shadow 为 none。

### 7.2 主列表最终尺寸与行样式

| 项目 | 当前结果 |
|---|---|
| 任务内模型菜单宽度 | 372px |
| 新建页三 CLI 菜单宽度 | 420px，左侧 CLI 栏宽 48px |
| CLI 栏入口 | 34×38px，9px 圆角；当前浏览项使用强调色，已有用量时显示 22×3px 余量条 |
| 主列表区域 | 428px；普通任务内面板含标题实测 471px |
| 外层高度上限 | 560px、视口高度减 120px，以及锚点上方实际可用空间共同约束 |
| 窄窗口验收 | 720×480 下，任务页列表 282px，新建页约 239px |
| 模型行 | 8px 圆角，水平 12px、垂直 8px；名称 14px/medium，描述 12px，右侧强度 12px |
| 默认标签 | 10px 文字、细边框，与选择高亮分开 |
| 悬停反馈 | 单个滑动底色层随指针移动；当前项另保留静态选中底色 |
| 主列表底部 | 原来的常驻大滑杆已移到行旁独立配置 |

新建页浏览另一个 CLI 的列表时，当前发送 CLI 保持原值；选择模型或提交强度调整后更新对应 CLI 的偏好和选择。

模型列表使用 `list`/`listitem`，每项中的选择按钮和配置按钮为同级原生按钮；选择状态使用 `aria-pressed`。配置入口独立于主按钮，保留 Tab、Enter/Space、ArrowLeft 与右键路径。它的固定位置与主按钮预留空间保持原有行宽。

### 7.3 独立配置

- 支持至少两个强度档位的模型提供 SlidersHorizontal 行内入口，悬停、键盘聚焦或展开时可见；也支持右键和 ArrowLeft。单档或无思考能力的模型继续直接选择。
- 浮层宽 264px，与主面板间隔 4px；内距 14px、底部 12px，外圆角 12px。标题 14px/semibold，最多两行；来源和说明使用 12px 次要文字。
- 优先放在完整主面板的左侧，另一侧空间合适时换边。纵向按所在模型行定位，同时限制在主面板和视口范围内；窄窗口可以覆盖主面板边缘。
- 浮层包含推理强度和“恢复默认”。指针松手或键盘调档后立即应用；恢复默认立即清空强度覆盖，继续跟随 CLI。
- **应用边界：** 更新 Tandem 下一条消息的模型与强度偏好，权限保持原值；运行中的轮次与已入队条目的选项继续使用原快照。关闭浮层保留已提交值，指针取消只撤销本次尚未松手的预览。Tandem 使用单份发送偏好，调整其他模型时一起选中该模型；Cindy 还支持非选中模型的独立强度记忆。
- 子浮层与主菜单共享 Portal 归属，调整滑杆和恢复默认时主菜单继续展开。Esc 先关配置并把焦点返回实际调用的选择或配置按钮，再次 Esc 关闭主菜单并返回入口。
- 键盘打开配置时，浮层定位并可见后再聚焦滑杆。模型面板及强度配置按需加载，沿用现有依赖。

代码：[ModelPickerPanel.tsx](../../desktop/src/components/ModelPickerPanel.tsx)、[ModelConfigFlyout.tsx](../../desktop/src/components/ModelConfigFlyout.tsx)、[ComposerMenu.tsx](../../desktop/src/components/ComposerMenu.tsx)、[ComposerControls.tsx](../../desktop/src/components/ComposerControls.tsx)、[useAnchoredPosition.ts](../../desktop/src/lib/useAnchoredPosition.ts)、[composerMenuPosition.ts](../../desktop/src/lib/composerMenuPosition.ts)、[modelFlyoutPosition.ts](../../desktop/src/lib/modelFlyoutPosition.ts)。

## 8. 生成会话标题与 Codex 消息展示

### 8.1 生成标题并写回原生会话

任务菜单提供“生成标题”，使用 CaseSensitive（Aa）图标；生成期间禁用重复操作，错误继续在任务中显示。标题栏在标题文字右侧显示所属 CLI 图标，通过悬停和可访问名称说明 Claude Code、Codex 或 Pi。Sparkles 保留给思考与运行状态，自动审批改用 ShieldCheck。

流程参考本机安装的 pi-web 0.15.0 的 auto-name：提取用户与助手文字，保留开头和近期结果，最多 6000 字符；使用当前模型在临时目录中独立生成，清理格式后标题最多 80 字符，超时 90 秒。

| CLI | 原生标题保存 |
|---|---|
| Claude Code | rename_session |
| Codex | thread/name/set |
| Pi | set_session_name |

生成请求与原对话隔离，结果写回原生标题元数据。运行中的 Claude/Pi 复用现有进程保存元数据；空闲任务短暂续接后退出。元数据操作与队列调度互斥，暂停队列保持暂停。

保存成功后采用原生标题，清理生成流程对应的本地别名；生成期间用户的手动改名仍优先。失败保留原标题。Codex 临时线程使用 ephemeral 和 sandbox: read-only。

### 8.2 Codex App 附件封装

针对用户截图中的整段“Files mentioned by the user / Image attachment / My request”文字，解析完整封装后展示实际请求正文、独立图片和普通文件标签。附件说明与系统提示从该封装的显示文本中去除，原生会话内容保持原样。普通 Markdown、不完整封装和多个文本块原有顺序继续保留。

“任务在其他程序运行”的提示属于原生写入权状态，与附件展示分别处理。Codex 的同时写入限制继续生效；复审时应核对真实占用状态和释放时机。

代码：[titles.rs](../../desktop/src-tauri/src/titles.rs)、[commands.rs](../../desktop/src-tauri/src/commands.rs)、[runner.rs](../../desktop/src-tauri/src/runner.rs)、[codex.rs](../../desktop/src-tauri/src/codex.rs)、[pi.rs](../../desktop/src-tauri/src/pi.rs)、[App.tsx](../../desktop/src/App.tsx)、[TaskMenu.tsx](../../desktop/src/components/TaskMenu.tsx)。

## 9. 复制终端续接命令

“复制终端续接命令”包含实际任务 cwd，包括 worktree 目录。复制结果的结构为：

```sh
cd -- '<任务目录>' && claude --resume '<会话 ID>'
cd -- '<任务目录>' && codex resume '<会话 ID>'
cd -- '<任务目录>' && pi --session '<会话 ID>'
```

目录与 ID 均使用 shell 单引号引用，内部单引号按 shell 规则转义。目录进入成功后执行续接。单元测试覆盖空格、单引号及 shell 元字符，并用 sh/zsh 验证。

代码：[terminalResume.ts](../../desktop/src/lib/terminalResume.ts)、[terminalResume.test.ts](../../desktop/src/lib/terminalResume.test.ts)、[TaskMenu.tsx](../../desktop/src/components/TaskMenu.tsx)。

## 10. 已讨论、当前仍保留原状的项目

| 讨论点 | 当前代码状态 |
|---|---|
| 侧栏直接露出置顶和归档 | 既有置顶/归档功能仍通过任务菜单操作；本次未增加行内双快捷按钮 |
| 任务转圈还是图标呼吸 | 侧栏保留 CLI 图标呼吸，运行状态行随活动呼吸；未实施侧栏 spinner 替换 |
| 左下角是否做账号入口 | 保留 Tandem 图标、名称、版本和设置入口；Tandem 继续采用无账号体系 |
| Agent 设置仿 Cindy，并查看各 CLI 的 Skills/MCP | 当前生产页仍展示本机 Agent 信息和已有安装/登录等操作；Skills/MCP 浏览方案尚未落地 |
| “插话/引导” | 实现待发送排序与移到队首，CLI 当前轮的引导能力仍预留 |
| 模型收藏 | 采用“默认”文字说明，未增加收藏和每模型偏好库 |
| 文件摘要进一步做 Git diff/撤销 | 当前为原生显式文件编辑的只读摘要，完整差异与撤销尚未落地 |

这些状态以 [Sidebar.tsx](../../desktop/src/components/Sidebar.tsx)、[TaskMenu.tsx](../../desktop/src/components/TaskMenu.tsx)、[SettingsView.tsx](../../desktop/src/components/SettingsView.tsx) 和模型面板代码为准。复审发现期待与现状有差距时，单独列为后续决策。

## 11. 同日共享工作区：设置页独立批次

设置页同日也有一批独立变更。本节据其 [验收记录](../measurements/2026-11-05-settings-actions.md) 和当前代码归纳，方便整体观感复审；远程协议及 relay/PWA 的其他实现使用各自任务的材料。

- 保持 Cindy 设置页几何：左侧导航 260px，内容最宽 920px，使用 settings-theme-card token。
- 添加项目、配对新设备位于分组标题右侧；加入、更改目录、移除、撤销放在对应行右侧。
- “保存更改”位于“中转服务”标题右侧，未修改时禁用；存在草稿时显示“还原更改”。卡片内保留地址、令牌和操作错误，连接状态位于“允许手机访问”的说明中。
- SettingsButton 统一为 32px 高、13px/500 字号、胶囊圆角。普通操作描边，提交使用中性灰底，辅助和行内操作采用轻量样式，撤销设备使用危险色。
- 加载保留文字占位和可访问名称。保存失败保留草稿，访问开关使用已保存配置；标题按钮通过 form 关联表单，点击与回车共用提交逻辑。
- 后端配置保存与撤销设备在写盘成功后更新内存，失败可重试。

代码：[SettingsView.tsx](../../desktop/src/components/SettingsView.tsx)、[SettingsButton.tsx](../../desktop/src/components/SettingsButton.tsx)、[remoteSettings.ts](../../desktop/src/lib/remoteSettings.ts)。

该批次原生流程通过页面脚本验证，存档截图来自实际前端构建在 Chromium 的运行结果，原因是当时原生窗口截图失败。队列/模型最终批次的存档截图来自目标 Tauri 窗口；两类证据分别保留来源。

## 12. Cindy 源码对照

本地参考仓库只读；用户可见界面使用 Tandem 品牌。Claude 复审时应打开对应源码核对几何和交互。

| 区域 | Cindy 参考源码 |
|---|---|
| 队列、合并输入卡片 | [PendingQueuePanel.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/PendingQueuePanel.tsx)、[ChatInput.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/ChatInput.tsx)、[SendButton.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/SendButton.tsx) |
| 光标、空白聚焦、发送后焦点 | [globals.css](../reference/repos/cindy/apps/desktop/src/renderer/styles/globals.css)、[composerBlankPointerFocus.ts](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/composerBlankPointerFocus.ts)、[useComposerSendFocusRestore.ts](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/useComposerSendFocusRestore.ts) |
| 底部 overlay 与高度测量 | [CCAgentSessionView.tsx](../reference/repos/cindy/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx)、[useComposerOverlayMetrics.ts](../reference/repos/cindy/apps/desktop/src/renderer/features/cc-agent/useComposerOverlayMetrics.ts) |
| 中断、文件行数与标题入口 | [InterruptedTurnBanner.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/chat/InterruptedTurnBanner.tsx)、[AgentActionRow.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/chat/AgentActionRow.tsx)、[SessionRenameInput.tsx](../reference/repos/cindy/apps/desktop/src/renderer/features/cc-agent/SessionRenameInput.tsx) |
| 模型菜单与行样式 | [ModelSelector.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/ModelSelector.tsx)、[UnifiedModelPanel.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/UnifiedModelPanel.tsx)、[UnifiedModelRow.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/UnifiedModelRow.tsx)、[morph-popover.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/ui/morph-popover.tsx) |
| 配置浮层与强度 | [UnifiedFlyoutHost.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/UnifiedFlyoutHost.tsx)、[ModelConfigFlyout.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/ModelConfigFlyout.tsx)、[unifiedModelSelection.ts](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/unifiedModelSelection.ts)、[effort-slider.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/ui/effort-slider.tsx) |
| 设置操作 | [button.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/ui/button.tsx)、[DialogueDirectorySection.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/settings/DialogueDirectorySection.tsx) |

Tandem 的有意适配包括：续聊最小 112px、32px 队列行与 18px 缩略图、24px 统一起点、队列区全体浅显操作、末行折叠、卡片上方共用运行/暂停状态行、调整强度时更新单份发送偏好、默认模型文字标签、无账号与收藏。以当前代码与对应条目核对这些差异。

## 13. 截图索引与版本区别

当前队列与配置截图见[本轮验收记录](../measurements/2026-11-06-desktop-review-fixes.md)，包含浅深色、1200×800 与原生 720×480 下的运行、暂停、编辑、折叠和展开共 20 张队列截图；下表为历史功能截图，包含已被替换的标题栏、常显操作、入队说明和二次确认按钮。复审以第 3、7、8、17 节的当前规则为准。

| 场景 | 图片 |
|---|---|
| 历史暂停队列、常显操作、入队说明与底栏 | [浅色](../measurements/assets/composer-coordination/paused-light.png)、[深色](../measurements/assets/composer-coordination/paused-dark.png) |
| 历史编辑态、单一取消与保存文字 | [深色](../measurements/assets/composer-coordination/editing-dark.png) |
| 历史窄窗口输入区 | [720×480 编辑浅色](../measurements/assets/composer-coordination/narrow-edit-light.png)、[720×480 暂停深色](../measurements/assets/composer-coordination/narrow-paused-dark.png) |
| 历史新建输入框 | [浅色](../measurements/assets/composer-coordination/new-light.png)、[深色](../measurements/assets/composer-coordination/new-dark.png) |
| 历史 Claude 模型配置 | [浅色](../measurements/assets/model-config-flyout/claude-light.png)、[深色](../measurements/assets/model-config-flyout/claude-dark.png) |
| 历史 Codex 模型配置 | [浅色](../measurements/assets/model-config-flyout/codex-light.png)、[深色](../measurements/assets/model-config-flyout/codex-dark.png) |
| 历史 Pi 模型配置 | [浅色](../measurements/assets/model-config-flyout/pi-light.png)、[深色](../measurements/assets/model-config-flyout/pi-dark.png) |
| 历史窄窗口模型配置 | [浅色](../measurements/assets/model-config-flyout/narrow-light.png)、[深色](../measurements/assets/model-config-flyout/narrow-dark.png) |
| 文件编辑清单 | [浅色摘要](../measurements/assets/queue-presentation/files-light.jpg)、[深色长清单](../measurements/assets/queue-presentation/files-dark.jpg)；该批输入框为后续调高前的状态 |
| 蓝色光标与空闲续聊高度 | [浅色](../measurements/assets/composer-focus/task-light.jpg)、[深色](../measurements/assets/composer-focus/task-dark.jpg)；队列提示对齐以后续批次为准 |
| 设置页 | [项目](../measurements/assets/settings-actions/projects-light.png)、[远程草稿](../measurements/assets/settings-actions/remote-dirty-light.png)、[深色配对](../measurements/assets/settings-actions/remote-pair-dark.png)，完整索引见设置页验收记录 |

截图中的临时任务名、模型名与额度数据用于验收。复审重点为对应状态的布局、层次、颜色、焦点和控件可见性。

## 14. 验证结果与边界

### 14.1 分批记录

以下数字是各批完成时的测试快照，前端总数按当时工作区统计，不能逐行相加。

| 批次与原始记录 | 前端单元测试 | Rust 测试 | 主要证据 |
|---|---:|---:|---|
| [消息队列](../measurements/2026-11-05-message-queue.md) | 60 | 127 | 三 CLI 替身、停止/出错/恢复、附件与重启、菜单栏计数 |
| [标题与附件显示](../measurements/2026-11-05-task-titles.md) | 64 | 146 | 真实 CLI 原生改名、临时线程协议、替身生成流程 |
| [模型能力与弹层](../measurements/2026-11-05-model-controls.md) | 77 | 152 | 三 CLI 真实元数据、六档、off、错误缓存与裁切修复 |
| [正文过渡](../measurements/2026-11-05-composer-overlay.md) | 81 | 152 | 渐隐、动态高度、贴底/历史滚动、浅深色补验 |
| [默认模型与方向](../measurements/2026-11-05-model-defaults.md) | 88 | 152 | 默认行合并、未知默认、向上方向；页面截图在后续批次补齐 |
| [队列样式与文件摘要](../measurements/2026-11-05-queue-presentation.md) | 94 | 152 | 常显操作、颜色、7 条续发、200 文件清单虚拟化 |
| [光标与输入高度](../measurements/2026-11-05-composer-focus.md) | 100 | 152 | 焦点归属、选区、失败保留草稿、112/140px |
| [独立模型配置](../measurements/2026-11-05-model-config-flyout.md) | 107 | 152 | 三 CLI 浅深色、预览/确认、两层 Esc、窄窗口 |
| [整体协调，历史批次](../measurements/2026-11-05-composer-coordination.md) | **111，18 个文件** | **152** | 8 条续发与重启、入队提示、编辑保存、最终截图和 release |
| [设置操作，独立批次](../measurements/2026-11-05-settings-actions.md) | 81 | 152 | 原生表单/写盘失败重试，浏览器样式截图，见其独立记录 |
| [UI review 修复，当时批次](../measurements/2026-11-06-desktop-review-fixes.md) | **127，21 个文件** | **152** | 队列与状态行 20 张最终截图、8 张模型截图、即时配置、停止/继续、排序编辑、重启与 release |
| [队列可靠性修复](../measurements/2026-11-06-queue-reliability.md) | **139，23 个文件** | **166** | 先复现 6 个 Store 缺陷、7 个 CLI 确认场景；坏文件通知、接收回执、运行中入队与强制终止恢复 |
| [最终 review 修复](../measurements/2026-11-06-final-review.md) | **145，26 个文件** | **178，1 项性能测量默认忽略** | 单次写入者授权、确认失败保留、同级模型按钮、独立图片与空文件清理、发送预览快照；8 张浅深色原生截图、崩溃恢复、release 性能复测 |
| [MCP 名称与工具行](../measurements/2026-11-06-tool-status.md) | **159，28 个文件** | **179，1 项性能测量默认忽略** | 运行行工具名称、并行完成顺序、MCP 可读标签、参数悬停与展开；原生浅深色和窄窗口 |

各批的 pnpm typecheck、pnpm test、cargo test 和 pnpm tauri build --bundles app 均通过。最终 review 的 release 约 5.31 MiB；此前 5.30 MiB、5.25 MiB 和 5.22 MiB 属于当时快照。截图和环境清理见各批验收材料。

### 14.2 已验与尚未覆盖

- 页面操作使用调试版 TANDEM_DRIVE_SCRIPT；CLI 替身通过 ZDOTDIR 注入。项目、队列、CLI 数据与原生测试会话放在临时目录。页面只保存内存状态，测试使用独立 DATA_DIR 和应用标识，结束后清理测试目录。
- 整体协调批次验证运行中入队、指针和键盘排序、编辑、删除、停止后暂停、恢复后 8 条自动续发、重启后 8 条的内容/次序/附件/发送选项，以及队列清空后的草稿与提示。最终 review 补验范围见第 19 节。
- 保存与取消竞争使用真实 IPC 等待验证：暂停隔离调试宿主 800ms，期间取消禁用，恢复后保存完成。
- 真实 CLI 元数据验证版本为 Claude Code 2.1.318、Codex 0.166.0、Pi 1.5.0。真实原生改名在临时空闲会话验证；运行中的 Claude/Pi 改名、模型生成和队列发送主要通过替身验证。
- 真实模型网络生成请求与系统级中文输入法交互尚未覆盖。页面组合输入事件有回归检查，不能替代系统输入法实测。
- 浅色、深色与 720×480 场景已经检查。早期锁屏造成的部分截图缺口在后续批次补验，来源记录分别保留。
- 四份用户 CLI 配置 SHA-256 在各批前后保持一致；测试会话、调试数据与进程按记录清理。Codex 线程启动与续接维持 sandbox: read-only。
- 未提交、未推送，保持 main。复审不得根据共享目录的改动数量推断本任务覆盖范围。

### 14.3 性能证据

消息队列首批做过小样本 release 抽样：主进程 26.6→27.4 MiB，主进程与 WebKit 合计 90.1→91.9 MiB，增加约 1.8 MiB。首屏三次基线为 819/459/525ms，新版为 512/390/389ms；该结果仅覆盖当时批次和小规模替身任务。

最终整体协调批次入口脚本约 414.79kB / gzip 125.96kB，队列分块约 10.64kB / gzip 3.46kB；模型面板批次独立分块约 15.78kB / gzip 5.22kB，文件摘要约 3.89kB / gzip 1.75kB。按需加载复用现有依赖。

最终 review 的 release 配对测量：空队列四进程合计中位数 81.88MiB；20 张 5MiB 图片由修复前 750.14MiB 降到 81.96MiB，测量状态为队列已加载的新建页。图片编辑和排序中位数由 250.54/254.95ms 降至 2.97/2.64ms。启动首组有波动，追加前后交替组中位数 344/348ms。补上发送气泡快照后又单独测最终代码，空队列和大图片队列均为 82.41MiB，启动中位数分别为 379/351ms。各组条件、窗口边界和全部原始结果见[最终性能记录](../measurements/2026-11-06-final-review.md#release-启动与内存)。瞬时内存峰值、全图解码与大旧文件迁移峰值留待专项测量。包体仍受共享工作区其他变更影响。

## 15. 给 Claude 的复审重点

下面是应重新核查的观察点，尚未判定为缺陷：

1. **业务与生命周期：** 停止→继续→再停止的竞争；领取与编辑/拖动/标题改名互斥；`inFlight` 与接收回执的持久化边界；坏文件隔离与通知；写入失败保留队首和草稿；重启暂停与空队列删除；图片保存、引用回收和隔离文件保留；单次写入者覆盖；确认卡片失败重试与其他调用先答的竞争。
2. **发送选项：** 三 CLI 能力过滤、默认引用、每条入队选项与当前工具栏分离；特别核对 model/effort 为默认引用时，CLI 配置变化下是否符合入队语义。
3. **浮层应用路径：** 松手与键盘调档后是否立即更新偏好；恢复默认、关闭浮层、指针取消、直接点模型行与 Enter/Space 是否保持同一份已提交状态。已排队选项与运行中轮次继续使用各自快照。
4. **长列表：** 队列和文件清单已有虚拟化；模型主列表当前使用 rows.map。按真实目录规模评估渲染、滚动和项目长列表规范，再判断是否需要调整。
5. **焦点与键盘：** 编辑取消/保存、异步提交期间主动转焦、两层 Esc、配置定位后聚焦、同级模型按钮与焦点返回、指针取消、组合输入，以及可访问名称/说明。
6. **视觉一致性：** 浅深色和窄窗口下的合并边框、32px 行、18px 缩略图、24px 起点、全队列浅显与聚焦操作、末行折叠、卡片上方共用运行/暂停状态行、图文中心对齐、阴影、交互指针、渐隐与末行完整性。
7. **原生数据边界：** 标题写回、附件封装只改变展示、Codex 写入权判定、临时标题任务清理、CLI 配置只读，以及 read-only sandbox。
8. **代码设计：** Portal 归属与监听清理、定位纯函数、状态所有权、错误传播、已有工具复用、按需加载和新增分支的必要性。

复审应按 AGENTS.md 执行两轮：先业务逻辑，再代码设计。测试通过属于证据之一，结论仍需对照代码、状态变化和截图。

### 可直接给 Claude 的任务说明

> 请只读复审 docs/reviews/2026-11-05-desktop-ui-details.md 涉及的桌面端变更，先读 AGENTS.md 及相关权威规则，再读当前实现和本地 Cindy 对照源码。
>
> 按业务逻辑、代码设计两轮检查，并打开本文最终截图核对样式。区分当前实现、有意适配、历史截图和讨论项。当前输入区与队列样式采用第 16、17 节及其验收材料；队列、确认卡片、模型按钮和性能采用第 19 节，接收确认的历史修复证据见第 18 节；工具运行名称与 MCP 工具行采用第 20 节，再按第 15 节复验关联逻辑。发现问题按 P0/P1/P2 给出文件与行号、触发条件、当前行为、预期行为及修复建议；将确认缺陷和待验证疑问分别列出。
>
> 工作区由多个任务共用。本次只出复审报告，不切分支、不 stash、不 reset、不提交或推送。需要发送验证时使用临时目录及测试会话；页面操作遵守 TANDEM_DRIVE_SCRIPT，测试前后备份和恢复 localStorage，CLI 配置保持只读，Codex sandbox 使用 read-only。报告分别说明业务逻辑、代码设计、验证证据和未覆盖风险。

## 16. 最新调整：标题密度与入队动作（2026-11-06）

本节记录用户后续确认的细节，复审当前版本时优先采用本节和对应验收记录。

| 调整 | 当前规则 | 复审重点 |
|---|---|---|
| 文件变更卡片标题区 | 最小高度 64→48px；左右内距 16→12px、上下 12→6px；图标盒 36→28px，FileDiff 18→16px | 14px 标题与行数继续分层显示；有行数时自然增高，浅深色和窄窗口均可阅读 |
| 入队说明小字 | 移除“本条消息将加入待发送队列”及其 aria-describedby 关联，清理对应文案和 useId 状态 | 空草稿、有草稿、运行中与暂停队列都使用同一规则 |
| 排队提交图标 | 15px ListPlus，表达将消息加入列表；按钮悬停提示与可访问名称为“加入待发送队列” | 与实际 queueing 状态一致；普通发送为 ArrowUp，编辑为“保存修改”，停止为 Square |

这次只调整文件标题区和提交动作的呈现。当时队列仍采用标题栏和常显行操作；用户后续确认恢复 Cindy 原版队列，当前规则见第 17 节。后端领取、排序、编辑和持久化沿用既有契约。

代码：[Composer.tsx](../../desktop/src/components/Composer.tsx)、[Composer.test.tsx](../../desktop/src/components/Composer.test.tsx)、[FileChangeSummary.tsx](../../desktop/src/components/FileChangeSummary.tsx)、[i18n.ts](../../desktop/src/lib/i18n.ts)。完整证据见[输入区动作简化验收](../measurements/2026-11-06-composer-actions.md)。

验收结果：标题区实测 48px，有行数时为 53px；浅深色与原生 720×480 均已看图。实际入队、运行中停止与入队并存、停止后暂停、编辑取消恢复草稿、删除最后一条后恢复普通发送均经替身验证。类型检查、前端 117 项与 Rust 152 项测试通过；release 构建通过。真实模型网络请求与系统输入法未测试。

## 17. 当前队列：Cindy 骨架与确认的适配（2026-11-06）

本节与第 3 节已直接更新为 review 后确认的规则；此前 26px 行、三列底栏以及逐行才出现操作的版本保留在历史验收记录。

| 项目 | 保留 Cindy 的部分 | 用户确认的适配 |
|---|---|---|
| 卡片 | 队列与输入共享 12px 外框，无标题栏 | 内部仅保留队列和输入区之间一条线 |
| 列表 | 13px 正文、1.25 行高、8px 行圆角、196px 上限、4px 滚动条 | 行最小 32px、缩略图 18px、上下各 6px |
| 左边缘 | 使用卡片内留白组织内容 | 队列/折叠/输入正文统一到 24px，把手移入文字左侧的独立留白；行底色左右各退 4px |
| 操作 | 20px 圆形按钮、静置隐藏、键盘可达 | 进入整个队列区时所有行浅显；固定 68px 占位，切换显示保持尺寸 |
| 附件 | 预览与附件名称提示 | 缩略图与数量紧跟正文，正文起点一致 |
| 末行与暂停 | 保留折叠和继续动作 | 折叠作为列表末行；暂停与运行共用卡片上方 32px 状态行。轻量 Pause 与 Sparkles 直接居中，右侧 24px 继续按钮与 Token 入口占同一位置 |
| 发送语义 | 共享编辑器 | Rust 持久化、附件/选项快照、指针和键盘排序沿用 Tandem 实现；移到队首仅改变待发送顺序 |

Cindy 的完整流程已核对：UnifiedFlyoutHost 管理 Portal、定位和关闭；ModelConfigFlyout 将滑块提交交给 UnifiedModelPanel 的 applyEffort，再由 useUnifiedRowActions 写入实时状态或模型记忆。当前选中行立即应用，非选中行可记录配置；原版没有“使用此模型”的确认步骤。Tandem 移除此按钮并按第 7.3 节说明单份偏好的应用边界。

代码入口：[ComposerStatusRow.tsx](../../desktop/src/components/ComposerStatusRow.tsx)、[QueuePauseStatus.tsx](../../desktop/src/components/QueuePauseStatus.tsx)、[PendingQueuePanel.tsx](../../desktop/src/components/PendingQueuePanel.tsx)、[ModelPickerPanel.tsx](../../desktop/src/components/ModelPickerPanel.tsx)、[ModelConfigFlyout.tsx](../../desktop/src/components/ModelConfigFlyout.tsx)、[App.tsx](../../desktop/src/App.tsx)、[TaskMenu.tsx](../../desktop/src/components/TaskMenu.tsx)。

此前批次的尺寸与截图见[历史队列 Cindy 验收记录](../measurements/2026-11-06-queue-cindy.md)。本轮全部截图、实际操作、测试结果与限制见[最新复审修复验收](../measurements/2026-11-06-desktop-review-fixes.md)。

最终 review 再次核对当前代码与原生窗口：1200×800 下两行均为 32px，图片 18px；队列正文 x=325px，输入正文同为 x=325px（输入元素左边缘 301px 加 24px 内距）。本批保持此几何，新增的本地图片预览、模型按钮结构和确认错误样式见[最终八张浅深色截图](../measurements/2026-11-06-final-review.md#原生命令链与截图)。

## 18. 队列可靠性复审修复（2026-11-06）

第 3.3 节已同步当前后端契约：坏文件逐个隔离并通知；空队列 `reserve` 清除历史暂停与错误；领取先保存 `inFlight`，CLI 接收确认后清除。Claude、Codex、Pi 都按各自协议回执决定是否恢复队首，`Started` 保留生命周期含义。重启时发送中消息回队首并暂停，由用户决定重发。

先补 6 个回归测试并确认旧实现失败；CLI 替身接收测试又复现了 7 个缺少确认的场景，随后修复。当前队列专项 27 项，包含三个 CLI 共 16 个独立子进程场景。前端类型检查、139 项前端测试和 166 项 Rust 测试通过。

页面脚本验证了坏文件提示、清空后运行中入队、自动续发启动失败后的队首恢复、拒收和接收后删除、显式继续，以及等待回执期间强制终止应用后的恢复。localStorage 已恢复，临时会话与测试数据已清理。本批没有改样式，未新增截图。完整证据和未验证边界见[队列可靠性验收](../measurements/2026-11-06-queue-reliability.md)。

## 19. 最终 review 清单与性能补验（2026-11-06）

第 1–3 项确认上一批实现已完成，保留测试并补跑原生命令链；本批按最终清单处理第 4–8 项。

- **一次发送授权：** `ignoreExternalWriter` 序列化时省略，旧文件读入时清除。失败尝试、继续、重启及后续条目重新检查写入者。页面每次发送消耗一次授权。
- **确认卡片：** 提交期间保留卡片与自定义回答，禁用重复回答。失败显示错误并恢复控件；后端明确返回 `requestSettled` 时结束旧卡片。桌面 IPC 扩展错误分类，手机现有协议保留。
- **模型结构：** 每项由同级选择按钮和配置按钮组成；原生键盘选择、ArrowLeft、右键配置和两层 Esc 继续可用，Esc 返回实际调用按钮。
- **队列存储：** 空队列删除文件。20 张 5MiB 图片使原 JSON 达到 133.34MiB，编辑与排序约 251/255ms，因此改为独立图片和小型元数据；迁移、损坏隔离、图片回收及本地预览均补测试。当前发送气泡携带独立预览，确认后的文件清理保持气泡可读。
- **验证：** typecheck、145 项前端测试、178 项 Rust 测试通过，另 1 项性能测试显式运行通过。三 CLI 子进程场景增至 17 个。原生调试包验证坏文件、停止后再排队、携带图片发送中强制终止恢复、写入者重新检查、确认失败与其他调用先答。
- **视觉：** 实际查看浅深色队列、模型列表、权限错误卡片、提问错误卡片共 8 张目标窗口截图。第 17 节的 32px/18px/24px/68px 规则继续成立。

实现、性能原始数据、截图、清理与未覆盖边界统一见[最终 review 验收](../measurements/2026-11-06-final-review.md)。旧批次的测试数量、包体和样式截图保留为历史证据。

## 20. 工具运行名称与 MCP 工作记录（2026-11-06）

此前“具体名称尚未接入”指运行行只有“正在调用工具”，现有工具事件里的名称没有用于显示；现在已接入。

| 位置 | Cindy 源码与当前呈现 |
|---|---|
| 输入框上方运行行 | `CCAgentSessionView.tsx` 的 RunningStatusBar 和 `localizeAgentStatus.ts`：工具名称加“运行中…”，右侧保留耗时与 Token。Tandem 沿用 32px 共用状态行、14px Sparkles、13px/medium 和活动呼吸；全文进入 title |
| 工作记录 MCP 主行 | `toolUseDescriptor.ts` 解析 `mcp__server__tool` 与 `mcp:server:tool`；服务器名保持原值，工具名下划线转空格。`actionPresentation.ts` 组成 `server · tool label`；AgentActionRow 使用 14px/medium 主文本、普通字重动词 |
| 悬停与展开 | 悬停显示原工具名与最多 80 字参数摘要，按 description/url/query/path/file_path/title/name/prompt 顺序提取。展开继续显示完整输入与已返回的结果 |
| 生命周期 | 等待用户确认优先于工具名称；工具结束清除名称；并行调用乱序结束时选择最近仍等待结果的工具。思考与回复遵循最新文字事件，名称保持在当前轮内 |

本次没有新增 CLI 事件或网络请求，也不新增 MCP 配置入口。Claude、Codex、Pi 继续使用已有 ToolUse/ToolResult 事件；运行名和工作记录标签在各自位置格式化。通用未知工具的主行按原名显示，具体参数进入展开详情。

补充 10 项前端回归（运行状态 6 项、MCP 主行 4 项）；全工作区快照为前端 159 项、Rust 179 项通过，另 1 项性能测量默认忽略。测试数据和截图范围见[工具名称验收记录](../measurements/2026-11-06-tool-status.md)。


## 21. Tandem 数据目录与配置归属（2026-11-07 更新）

- `config.toml`、`state.json`、`remote.json`、待发送队列和无项目工作目录统一归入 `~/.tandem/`。各 CLI 的配置、凭证和会话仍归各自 CLI。
- 设置页、模型选项与项目路径只向 Rust 提交发生变化的字段；Rust 用 `toml_edit` 保留 TOML 注释和次序。置顶、归档、别名、项目顺序和侧栏状态写入 `state.json`。两个文件原子写入。
- 主窗口和菜单栏面板创建时注入同步配置，首屏应用主题；运行中手改广播到两个窗口。语法、类型或已知值错误时保留原文件，沿用进程内上次有效值；未知字段只提示完整字段名，有效字段继续应用，设置页保存保留未知字段及其注释。
- 根目录 `0700`，手机密钥 `0600`，自动生成 `.gitignore` 排除私钥、缓存与临时文件。`remote.json` 含私钥，只在本机保存，丢失后重新配对，无需备份。
- 首次启动直接创建配置和忽略规则，页面和发送无需等待。状态损坏时改名保留并使用默认值，通过 errors 提示；状态缺失和未知字段均保持可用。
- `.storage.lock` 保留进程级单写入者保护；第二个实例只读并显示明确提示，退出占用者后重新打开。模型列表、用量、上下文窗口、安装状态只在内存缓存，当前不创建 `cache/`。手机任务视图从后端构建。

上一批的历史验证与性能见[统一目录历史验收](../measurements/2026-11-06-unified-storage.md)。当前清单、失败测试、旧目录清理、原生替身和完整检查见[存储最终复审](../measurements/2026-11-07-storage-final-review.md)。

## 22. 存储最终复审与旧数据清理（2026-11-07）

删除旧导入和内联图片兼容，保留单实例写锁。坏状态改名保留并采用默认值，发送与队列独立；隔离失败时拒绝覆盖原文件的状态保存。未知状态字段忽略，未知 TOML 字段提示名称并保留注释。发送参数收进请求结构、较大控制请求用 Box，桌面端 clippy 清零。CI 新增 macOS 桌面检查，文档站补充准入文件读取失败及原令牌重新登记的恢复办法。

先失败后修复的 6 项回归均通过。167 项前端、193 项 Rust、11 项 relay Rust、20 项 WebSocket 和 2 项站点测试通过，类型检查、两端 clippy、站点组合构建和 actionlint 通过。原生替身覆盖坏状态、缺失状态、未知字段、空目录与双实例；另通过输入框验证真实发送链路。实际查看并留存六张窗口截图，见[完整证据](../measurements/2026-11-07-storage-final-review.md)。

本机删除了旧 Application Support 的空 `queues/` 和 WebKit 实际位置的旧 `localstorage.sqlite3`；旧 remote.json 原本不存在。CLI 配置保持只读；测试数据和进程的清理、release 打开及遗留验证边界在验收记录中单独列明。
