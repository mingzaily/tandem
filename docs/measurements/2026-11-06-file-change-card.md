# 2026-11-06：文件变更卡片回到消息流

> 本记录保存本批实现与截图。后续按用户要求将标题区压为最小 48px，并简化排队提交提示，见[输入区动作简化验收](2026-11-06-composer-actions.md)及[待复审材料第 16 节](../reviews/2026-11-05-desktop-ui-details.md#16-最新调整标题密度与入队动作2026-11-06)。

## 问题与来源

用户反馈“文件已更改”清单偏在按钮左边，输入区、队列和摘要的混合样式缺少统一感。旧浮层使用右边缘对齐，420px 清单与窄触发器因此共用右边缘。

核对本地 Cindy 的 [TurnChangesCard.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/chat/TurnChangesCard.tsx) 和 [MessageStream.tsx](../reference/repos/cindy/apps/desktop/src/renderer/components/chat/MessageStream.tsx) 后，改用它已有的消息流内嵌结构：变更属于对应轮次的结果，默认列出 3 个文件，继续展开更多。

## 实现与复刻范围

| 项目 | 当前结果 |
|---|---|
| 位置 | 每轮结束后追加到该轮消息末尾，下一轮开始后保留历史卡片 |
| 卡片 | 12px 圆角、细边框，使用原版 surface-elevated、border-default 等 token |
| 标题区 | 最小 64px 高，水平 16px、垂直 12px 内距；36px 图标盒、18px FileDiff |
| 文字与行数 | 标题 14px/medium；累计行数在下一行，12px 等宽，使用 diff 增删颜色 |
| 文件列表 | 36px 行高、15px 文件图标、13px 文件名、8px 左右内距 |
| 展开 | 默认 3 个文件，底部 32px 高的“还有 N 个文件”/“收起”入口 |
| 消息流居中 | 对称预留滚动槽，修正单侧 8px 滚动条造成的 4px 中轴偏移 |
| 历史与状态 | 展开状态保存在消息流中，行虚拟卸载后仍保持；运行中的当前轮结束后才生成卡片 |

结构、几何、主字号和 token 按上述 Cindy 源码实现。Tandem 保留以下功能适配，因此本批结论限定为文件变更区的样式收拢：

- 展示原生成功编辑记录的只读派生数据，完整差异查看和撤销继续由独立能力实现。
- 长路径以文件名开头，目录用 12px 次要文字，完整路径通过悬停查看；文件行采用已有的 FileText 图标。
- 长文件清单虚拟化，展开区最高 252px。完整统计未知时只展示文件数和已有的逐文件数据。
- 队列常显操作、独立模型配置等此前确认的适配仍按各自文档实施。本批没有对整个应用作逐像素一致性结论。

输入区原有摘要胶囊、文件清单浮层和长段可见技术说明已移除；来源说明保留在卡片标题的悬停说明中。文件卡片与消息流一起按需加载。

代码：[FileChangeSummary.tsx](../../desktop/src/components/FileChangeSummary.tsx)、[fileChanges.ts](../../desktop/src/lib/fileChanges.ts)、[MessageStream.tsx](../../desktop/src/components/MessageStream.tsx)、[App.tsx](../../desktop/src/App.tsx)、[app.css](../../desktop/src/styles/app.css)。

## 审查

- **业务逻辑：** 检查按用户消息划分轮次、工作组还原、成功编辑过滤、行数可信度、运行与中断边界、历史归属。历史轮与当前运行轮分别投影，工具结果、中断与压缩保持在所属轮次。
- **代码设计：** 派生行在纯函数中组织；卡片接受汇总数据与受控展开状态；长清单复用现有虚拟化。保留原生会话来源及现有 CLI 进程结构。

## 验证方式

调试包使用独立 productName 和 identifier。全部页面交互由 TANDEM_DRIVE_SCRIPT 驱动，通过 ZDOTDIR 注入三 CLI 替身。工作目录、构造的 Claude 原生记录、队列与 CLI 数据均放在临时目录。每个测试页面的 localStorage 在修改前备份，结束后恢复并核对。

浅深色截图来自目标 Tauri 窗口。screencapture 本轮返回无法创建窗口图片，改用窗口工具返回的目标窗口截图；页面交互继续走调试脚本。

## 验证结果

| 检查 | 结果 |
|---|---|
| pnpm typecheck | 通过 |
| pnpm test | 18 个文件、117 项通过，新增 6 项轮次投影与路径展示回归测试 |
| cargo test | 152 项通过 |
| 卡片与数据 | 默认 3 条、展开与收起、完整统计、未知统计、跨项目长路径及无修改轮次通过 |
| 草稿与焦点 | 展开保留输入草稿；展开入口可聚焦，aria-controls 关联正确；长清单可接收焦点 |
| 200 个文件 | 仅挂载 10 行，末项可滚动读取，累计统计为 +20100 / −199 |
| 历史保留 | 同一路径在不同轮次分别统计；25 轮历史中，卡片滚出后卸载，返回时保持展开 |
| 浅色与深色 | 宽窗口、暂停队列并存、长文件列表及 720×480 窗口截图均已查看 |
| 原生 720×480 | 卡片实测宽 404px、高 224px，与输入区中轴一致；默认卡片完整可见、展开入口位于输入区上方，无横向溢出；展开后末项可读，收起恢复 3 行 |
| release | pnpm tauri build --bundles app 通过，应用包约 5.22 MiB；新版本独立启动，3 个既有进程及其窗口状态保留 |

两轮审查完成。本轮没有发送模型提示词；替身日志中的模型生成请求数为 0。两个测试页面的存储恢复结果分别逐键匹配备份。临时原生任务、队列、替身、调试进程、测试应用和独立 WebKit 数据已清理。四份用户 CLI 配置的 SHA-256 与本批开始时一致。保持 main，未提交或推送。

入口脚本约 414.58kB / gzip 125.89kB，文件卡片并入原有按需加载的消息流分块；沿用现有依赖，CLI 请求与进程结构保持原样。本轮未重新测量启动耗时、内存峰值和超大原生历史的派生计算耗时。

## 截图

| 场景 | 图片 |
|---|---|
| 浅色、队列与结果区分层 | [浅色](assets/file-change-card/light.jpg) |
| 深色、展开历史文件卡片 | [深色](assets/file-change-card/dark-expanded.jpg) |
| 200 个文件的长清单 | [浅色](assets/file-change-card/large-light.jpg) |
| 原生 720×480 | [浅色](assets/file-change-card/narrow-light.jpg)、[深色](assets/file-change-card/narrow-dark.jpg) |

供 Claude 复审时结合 [11 月 5 日细节材料](../reviews/2026-11-05-desktop-ui-details.md) 阅读：文件变更区以本记录为最新实现，其余区域按各自的当前代码与验证记录核对。
