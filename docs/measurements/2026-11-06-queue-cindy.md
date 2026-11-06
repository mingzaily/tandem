# 2026-11-06：队列布局与密度统一回 Cindy

> 历史验收。本页保留当批的尺寸与证据；review 后的队列密度、把手间距和卡片上方状态行见[最新复审修复验收](2026-11-06-desktop-review-fixes.md)，当前规则见设计规则与待复审材料第 3、17 节。

用户确认将队列的布局、密度和视觉层级统一回 Cindy。本次替换此前混用 Codex App 常显操作和自加标题栏的呈现，保留 Tandem 的 Rust 队列、指针排序和键盘操作。

## 源码对照与落地

只读对照：Cindy 的 [PendingQueuePanel.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/PendingQueuePanel.tsx)、[ChatInput.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/ChatInput.tsx)、[pendingQueueRowActivity.ts](../reference/repos/cindy/apps/desktop/src/renderer/components/new-chat/pendingQueueRowActivity.ts) 及全局滚动条样式。按钮采用原版的 secondary / xxs / compact 几何。

| 部分 | 当前实现 |
|---|---|
| 外框 | 队列与输入框共用 12px 圆角和边框，内部细线分区；列表直接起排，区域名称保留在 aria-label |
| 列表 | 上/下/左右内距 6/2/4px；最大高度 196px，4px 滚动条、对称滚动槽。5 条起收成前 3 条 |
| 行密度 | 默认行高 26px；正文 13px、1.25 行高、下移 1px，纵向内距 2px、横向 8px。行高随字号自然增长 |
| 静置与激活 | 静置正文使用 settings-section-desc；指向或聚焦时使用 msg-assistant-text，并显示 chip 背景。指针离开时保留键盘聚焦行的操作 |
| 行操作 | 20px 拖动把手与圆形按钮；按钮为 12px 移到队首、11px 编辑和删除，笔画 2.25。三按钮占位 68px，暂时隐藏编辑时占位 44px，静置行保留等宽占位 |
| 编辑 | 当前编辑行保留高亮与 20px 占位，正文在主输入框修改；取消和保存集中在输入区。清除此前“编辑中”标签及中英文文案 |
| 底栏 | 暂停或超过 4 条时出现。三列分别放 warning-fg 暂停提示、居中折叠、22px 中性“继续发送”；折叠为 20px，不加状态图标 |
| 提交与结果 | 沿用上一批的 ListPlus 入队图标、输入区单一取消/保存入口，以及消息流中的每轮文件变更卡片 |

Tandem 的功能适配继续明确保留：“移到队首”仅调整待发送顺序，插话仍为预留能力；附件展示缩略图和数量；长队列使用已有虚拟列表；后端持有附件和入队选项。原版的 SortableList 由项目已有的指针事件与键盘排序替代。

代码：[PendingQueuePanel.tsx](../../desktop/src/components/PendingQueuePanel.tsx)、[pendingQueue.ts](../../desktop/src/lib/pendingQueue.ts)、[app.css](../../desktop/src/styles/app.css)、[i18n.ts](../../desktop/src/lib/i18n.ts)。

## 审查与单元测试

**业务逻辑审查：** 检查活动/暂停队列、折叠、编辑保存与取消、焦点归属、自动领取与操作锁。行操作继续调用后端命令；入队附件、选项、停止与重启后的暂停语义一致。指向和聚焦分别记录，移开指针后聚焦行继续可操作；开始编辑时清理原操作焦点，移除条目时清理活动状态。

**代码设计审查：** 复用 Cindy token、项目虚拟列表和已有队列 API；行高采用自然布局与实测尺寸。拖动插入槽和标记按实测行位置计算，替换原来按固定 32px 和列表内距推算的逻辑。清理旧标题栏图标与编辑短标签，沿用共享输入区和后端生命周期。两轮审查完成，当前范围无已知阻塞问题。

- pnpm typecheck 通过。
- pnpm test：19 个文件、122 项通过；新增 2 项变高行排序计算测试和 3 项队列结构测试。
- cargo test：152 项通过。

## 页面与 CLI 替身验收

通过独立标识调试包的 TANDEM_DRIVE_SCRIPT 操作 DOM。ZDOTDIR 注入三种 CLI 替身；Claude 的实际发送、会话文件、附件、队列和 CLI 数据均在临时目录。临时构建仅为窗口尺寸测试加入 set-size 权限，release 使用仓库正式能力配置。

| 验证 | 结果 |
|---|---|
| 浅色/深色 | 已查看目标 Tauri 窗口截图；静置层次、激活行、圆形操作、暂停底栏符合源码对照 |
| 实测几何 | 3 行列表 86px，含暂停底栏的区域 122px；行高 26px、按钮/缩略图 20px、继续按钮 22px |
| 操作显隐与焦点 | 静置行只有可聚焦把手；指向或聚焦后呈现 3 个动作。移开指针保留焦点操作，移到输入区后恢复静置 |
| 排序与编辑 | 指针排序、键盘 End/Home 跨折叠范围移动与焦点恢复、移到队首、删除均通过；编辑保存/取消恢复原草稿，附件保留 |
| 大字号与长队列 | 18px 字号设置对应的正文为 17px；行实测 27–28px，指针排序准确。22 条时列表上限 196px，当时仅渲染 10 行 |
| 最小窗口 | 页面脚本将原生窗口设为 720×480，队列宽 438px；页面无横向溢出，继续与入队按钮位于视口内 |
| 正常续发 | 替身当前轮正常结束后，排队消息依次发出；清空后恢复普通发送 |
| 运行中入队与停止 | 有草稿时停止和入队动作并存；停止后两条消息保留，底栏显示暂停和继续 |
| 重启与继续 | 重启调试进程，逐字段比较两条消息、顺序、附件和选项，内容一致且保持暂停；点击继续后依次发送 |
| 原生边界 | 12 次替身发送全部位于临时项目；重启后携带 PNG 与 audit-queued / high / acceptEdits 原选项，按顺序交给 CLI |

截图接口会重新调整窗口大小，因此最小窗口以脚本记录的原生尺寸和 DOM 断言为证；保存的图片使用常规窗口尺寸。直接 screencapture 无法读取该目标窗口，本批未保存有效的最小窗口截图。

驱动脚本中的对象比较先规范化字段顺序，目录按 canonical 路径比较（macOS 的 /var 与 /private/var 指向同一目录）；选择器使用实际可访问文案，并区分空草稿和有草稿时的提交入口。详细通过记录见 [checks.json](assets/queue-cindy/checks.json)。

截图：[浅色静置](assets/queue-cindy/light-idle.jpg)、[浅色聚焦](assets/queue-cindy/light-focus.jpg)、[深色指向](assets/queue-cindy/dark-hover.jpg)、[运行中短队列](assets/queue-cindy/running.jpg)。

真实模型网络请求、系统输入法和系统鼠标键盘未测试；本批实际发送使用 Claude 替身，Codex/Pi 保留为隔离的读取替身。本轮未重复测量启动速度与峰值内存。

## 构建与清理

pnpm tauri build --bundles app 通过，应用约 5.22 MiB。入口脚本约 414.82kB / gzip 125.90kB，队列独立块约 10.26kB / gzip 3.67kB，沿用已有依赖和进程结构。新版本另开窗口，既有窗口保留。

测试页面的 localStorage 在测试前备份，测试后逐键恢复并核对。测试会话、队列、附件、替身、调试应用与独立 WebKit 数据在本批结束时清理；四份用户 CLI 配置 SHA-256 与本批开始时一致。保持 main，未提交或推送。
