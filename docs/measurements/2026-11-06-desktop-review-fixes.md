# 2026-11-06：桌面 UI 复审修复验收

> **状态：参考。** 本页记录当前复审修复及后续截图反馈。待 Claude 复审的完整材料见 [桌面端细节](../reviews/2026-11-05-desktop-ui-details.md)；权威约定同步到设计规则和原生会话规则。

## 源码核对与实现边界

只读核对 Cindy 的 `PendingQueuePanel.tsx`、`ChatInput.tsx`、`CCAgentSessionView.tsx`、`UnifiedModelPanel.tsx`、`UnifiedFlyoutHost.tsx`、`ModelConfigFlyout.tsx`、`useUnifiedRowActions.ts`、`effort-slider.tsx` 和 `morph-popover.tsx`。

| 区域 | 核对结果与当前实现 |
|---|---|
| 队列骨架 | 保留原版无标题栏、共享输入卡片、13px 正文、1.25 行高、8px 行圆角、20px 圆形操作、196px 列表上限与 4px 滚动条 |
| 密度 | 用户确认的适配：32px 行、18px 缩略图、列表上下各 6px。行底色左右各退 4px；正文与输入框从卡片内 24px 起排，把手位于独立的左侧留白。24px 取代早先 16px，回应把手与正文过近的反馈 |
| 显隐 | 静置隐藏操作，进入整个队列区后所有行以 0.4 透明度显示，当前指向或聚焦行显示完整操作；固定 68px 操作占位。键盘焦点在指针离开后继续保留 |
| 附件与折叠 | 缩略图和数量紧跟正文；超过 4 条时预览前 3 条，“还有 N 条”作为列表末行，和正文同起点 |
| 状态位置 | 用户后续要求状态始终位于整张输入卡片上方。运行和暂停共用 ComposerStatusRow：32px 行、13px/medium、14px 图标、水平 8px、下距 6px、右侧 24px 控件。运行显示耗时/Token，暂停显示轻量 Pause 与“继续发送”；队列区内部只有列表和输入框之间一条线 |
| 图文对齐 | 原版 Sparkles 向上偏移 1px；Tandem 按用户截图反馈移除此偏移，Pause 同步修正。两种图标与文字的布局中心一致。继续按钮位于同一右侧信息区；队列的内部边框使按钮外沿存在 1px 差值 |
| Cindy 暂停与 MCP | 原版暂停继续入口在队列底栏；原版运行行左侧允许显示当前工具名，包括 mcp__…，右侧显示耗时与 Token/速度。本批当时保留“正在调用工具”；后续已接入具体名称并统一 MCP 工作记录主行，见[工具名称验收](2026-11-06-tool-status.md) |
| 标题与图标 | 生成标题只保留任务菜单，使用 CaseSensitive；自动审批使用 ShieldCheck；Sparkles 专用于思考与运行。标题右侧为所属 CLI 图标，带名称提示和可访问名称 |
| 模型列表 | Cindy 的主体列表固定 428px，随可用空间压缩并内部滚动，数量较少时也保留高度。Tandem 沿用该骨架与向上展开规则 |
| 强度提交 | 原版完整链路为滑块提交 → ModelConfigFlyout → UnifiedModelPanel.applyEffort → useUnifiedRowActions。松手或键盘调档后生效；选中模型应用到实时状态，其他模型可写入独立记忆。Tandem 移除“使用此模型”，更新单份下一条发送偏好，调其他模型时一同选中该模型，保留“恢复默认”；运行中轮次与已排队消息保持原快照 |
| 阴影 | 原来 `shadow-[var(--shadow-menu)]` 被 Tailwind 解释为颜色，实际 box-shadow 为 none。模型主面板、配置浮层、普通菜单和速度卡片改用 `shadow-[shadow:var(--shadow-menu)]`；实际读到浅色 .15、深色 .5 的 0/4/16px 阴影 |
| 指针 | 按钮、菜单、链接和选择项为手形，文本输入为 I 形，把手为 grab/grabbing，强度滑块为 ew-resize，禁用控件为普通箭头；保留各组件悬停、按下和键盘焦点反馈 |

这是保留 Cindy 骨架并明确列出适配的实现。Tandem 的 Rust 队列、指针/键盘排序、附件所有权和发送选项快照沿用既有契约。

## 测试环境与方法

使用独立标识 `com.mingzaily.tandem.review-ui-audit` 的 Tauri 调试包。全部交互通过 TANDEM_DRIVE_SCRIPT/TANDEM_DRIVE_WATCH 的页面事件与后端命令完成；ZDOTDIR 指向临时 CLI 替身。项目、Claude/Pi/Codex 数据与队列位于同一个临时根目录。此次实际发送使用 Claude 替身，Codex/Pi 用隔离的模型读取替身。

截图来自目标原生窗口的 getScreenshot，直接保存原始 JPEG，保持系统 Retina 倍率。窗口尺寸由页面脚本设置并重新居中，保证整张窗口在屏幕范围内；临时构建的 set-size/center 权限只在外部配置中，release 使用仓库配置。截图接口保持 720×480 窗口尺寸，未模拟系统鼠标键盘。

脚本同时检查页面与列表的 scrollWidth、正文起点、行高、缩略图尺寸、状态位置和显隐前后的矩形。展开会自然增高，编辑说明会增加输入区高度；操作显隐保持原尺寸。此前驱动脚本的顶层 await、同一轮连续 Esc 的异步关闭时机，以及测试中途选择/窗口尺寸变化均已修正或重跑。最终报告只收录相应状态的通过记录。

## 页面流程结果

| 验证 | 结果 |
|---|---|
| 入队与停止 | 运行中入队 2 条，其中 1 条含 PNG；点击停止后原条目、附件和选项保持，卡片上方出现暂停与继续 |
| 恢复与续发 | 点击顶部“继续发送”，2 条按序交给替身；后者收到 PNG。清空后恢复普通发送，暂停与队列控件撤去 |
| 重启 | 重启前后比对 4 条任务队列、共 14 条消息的 ID、顺序、正文、附件、选项、暂停和错误字段，内容一致；重启后均保持暂停 |
| 排序 | Pointer Events 拖动、键盘 Home/End、跨折叠范围展开与焦点恢复、移到队首通过 |
| 编辑与删除 | 保存和取消均恢复原草稿；编辑保留原附件及发送选项；删除成功，测试条目随后补回以完成截图 |
| 显隐与几何 | 静置隐藏、全队列浅显、活动行突出、移开指针保留键盘焦点通过；悬停前后行宽、文字起点和列表高度一致 |
| 状态与对齐 | 暂停和运行行均为 32px，右侧控件均为 24px；状态在整张卡片上方。Pause 与 Sparkles 的布局中心分别与文字中心一致 |
| 模型配置 | 三 CLI 的指针预览、取消、松手立即应用、键盘调档、恢复默认、Esc 保留提交值均通过；主菜单保持展开。调整 Claude 的另一个模型时同时更新模型和强度 |
| 选项隔离 | 模型调整前后对比已有队列快照，完全一致；权限偏好保持原值 |
| 入口与阴影 | 生成标题位于任务菜单，Aa/ShieldCheck 与 CLI 图标正确；浅深色实际 box-shadow 生效，主菜单向上且配置浮层位于视口内 |

通过记录及矩形见 [checks.json](assets/review-ui/checks.json)。

## 已逐张查看的截图

下列 20 张为移除图标偏移后的最终队列矩阵。常规窗口为 1200×800，窄窗口为原生 720×480；无页面或队列横向滚动，状态、折叠和提交入口均在视口内。

| 状态 | 浅色常规 | 深色常规 | 浅色窄窗口 | 深色窄窗口 |
|---|---|---|---|---|
| 运行、2 条 | [图片](assets/review-ui/light-1200-running.jpg) | [图片](assets/review-ui/dark-1200-running.jpg) | [图片](assets/review-ui/light-720-running.jpg) | [图片](assets/review-ui/dark-720-running.jpg) |
| 暂停、2 条 | [图片](assets/review-ui/light-1200-paused.jpg) | [图片](assets/review-ui/dark-1200-paused.jpg) | [图片](assets/review-ui/light-720-paused.jpg) | [图片](assets/review-ui/dark-720-paused.jpg) |
| 3 条预览与折叠 | [图片](assets/review-ui/light-1200-collapsed.jpg) | [图片](assets/review-ui/dark-1200-collapsed.jpg) | [图片](assets/review-ui/light-720-collapsed.jpg) | [图片](assets/review-ui/dark-720-collapsed.jpg) |
| 展开并滚至末行 | [图片](assets/review-ui/light-1200-expanded.jpg) | [图片](assets/review-ui/dark-1200-expanded.jpg) | [图片](assets/review-ui/light-720-expanded.jpg) | [图片](assets/review-ui/dark-720-expanded.jpg) |
| 编辑、3 条 | [图片](assets/review-ui/light-1200-editing.jpg) | [图片](assets/review-ui/dark-1200-editing.jpg) | [图片](assets/review-ui/light-720-editing.jpg) | [图片](assets/review-ui/dark-720-editing.jpg) |

操作状态补图：[浅色](assets/review-ui/queue-active-light.jpg)、[深色窄窗口聚焦](assets/review-ui/queue-active-dark.jpg)。

三种 CLI 配置及阴影也逐张查看：[Claude 浅色](assets/review-ui/model-claude-light-1200.jpg)、[Claude 深色](assets/review-ui/model-claude-dark-1200.jpg)、[Codex 浅色](assets/review-ui/model-codex-light-1200.jpg)、[Codex 深色](assets/review-ui/model-codex-dark-1200.jpg)、[Pi 浅色](assets/review-ui/model-pi-light-1200.jpg)、[Pi 深色](assets/review-ui/model-pi-dark-1200.jpg)、[浅色窄窗口](assets/review-ui/model-codex-light-720.jpg)、[深色窄窗口](assets/review-ui/model-pi-dark-720.jpg)。深色切换后首次截图出现局部旧表面，重新核对 computed style 与目标窗口绘制后保存了完整深色图。

## 两轮审查、测试与限制

业务逻辑审查覆盖队列状态位置、停止/恢复与调度边界、操作锁和焦点、编辑保留附件/选项、强度提交时机及入队快照隔离。代码设计审查覆盖共享状态行、固定操作占位、实测拖动位置、Portal 归属/监听清理、语义指针和阴影写法。两轮审查与对应页面回归完成，本轮范围无已知阻塞问题。

- pnpm typecheck 通过。
- pnpm test：21 个文件、127 项通过。
- cargo test：152 项通过。
- pnpm tauri build --bundles app 通过，应用约 5.25 MiB；入口脚本约 416.62kB / gzip 126.11kB，队列块 9.49kB / gzip 3.48kB，模型块 15.36kB / gzip 5.13kB。

本轮没有真实模型网络请求，也没有系统鼠标键盘或中文输入法实测。工具名称和队列性能在后续批次补验，分别见[工具名称验收](2026-11-06-tool-status.md)与[最终 review 验收](2026-11-06-final-review.md)。本批当时没有重新测量启动耗时、峰值内存和大量图片队列占用。

测试页面 localStorage 已逐键恢复并核对（原备份为空）；临时项目、会话、队列、CLI 替身、调试包和独立 WebKit 数据已清理。四份用户 CLI 配置 SHA-256 与批次开始时一致。release 已另行打开，原生窗口为 1200×800 且可见；只结束验收实例，用户窗口保持原样。详细结果见 checks.json 的 cleanup 和 release 字段。保持 main，未提交或推送。
