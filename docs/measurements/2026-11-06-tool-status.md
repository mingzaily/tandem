# 2026-11-06：工具运行名称与 MCP 工作记录

> **状态：参考。** 本批只修改桌面端和相关文档，保持 main，未提交。当前细节同步到[待 review 文档第 20 节](../reviews/2026-11-05-desktop-ui-details.md#20-工具运行名称与-mcp-工作记录2026-11-06)。

## Cindy 源码核对

| 来源 | 核对结果与应用 |
|---|---|
| `features/cc-agent/CCAgentSessionView.tsx` 的 RunningStatusBar、`localizeAgentStatus.ts`、中文 `runningTool` 文案 | 运行行左侧可以显示工具名称加“运行中…”，右侧保留耗时与 Token。长文字单行省略 |
| `packages/maker-shared/src/toolUseDescriptor.ts` | MCP 名称支持 `mcp__server__tool` 和 `mcp:server:tool`；服务器标识保持原值，工具部分的下划线转空格 |
| `lib/agent-actions/actionPresentation.ts` 的 `extractDisplayParam` | MCP 主行展示 `server · tool label`；悬停显示原工具名与参数摘要 |
| `components/chat/AgentActionRow.tsx`、`activityRowChrome.ts` | 主文字 14px/medium，动词普通字重，尾部箭头进入详情；完整参数与返回结果可展开查看 |

## 当前行为

- 运行状态使用已有 ToolUse/ToolResult 事件里的名称，显示如 `mcp__memory__search_nodes 运行中…`。名称没有传回时继续使用“正在调用工具…”。
- 工作记录主行显示“调用 memory · search nodes”。参数摘要只进入悬停说明，点击展开读取完整输入与结果；通用未知工具主行保留原名。
- 悬停参数摘要沿用 Cindy 的 description/url/query/path/file_path/title/name/prompt 优先级，最多 80 字符；原始输入保持完整。
- 等待用户确认时优先显示“等你确认…”。并行工具乱序完成后，显示最近仍等待结果的调用；工具全部完成后恢复思考，文字输出时进入回复状态。
- 继续沿用原来的 32px 状态行、14px Sparkles、13px/medium、单行动画和右侧统计。完整运行名称放在 title 中，状态内容变化或新活动触发呼吸。
- Claude、Codex、Pi 的后端事件、CLI 配置和手机协议沿用现状，本批只接显示与展示格式。

代码：[items.ts](../../desktop/src/lib/items.ts)、[RunningStatus.tsx](../../desktop/src/components/RunningStatus.tsx)、[tools.ts](../../desktop/src/lib/tools.ts)、[MessageStream.tsx](../../desktop/src/components/MessageStream.tsx)、[i18n.ts](../../desktop/src/lib/i18n.ts)。

## 回归与原生验证

先运行新增测试，复现名称缺失和 MCP 主行拼接 query 的问题，再修复。新增 10 项前端回归覆盖工具事件名称、失败结果后的切换、并行调用、确认优先、空名称、长名称、参数隔离、两种 MCP 命名格式、摘要优先级与长度、未识别名称。

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 159 项通过，28 个文件，含共享工作区其他批次测试 |
| `cargo test` | 179 项通过，1 项性能测量默认忽略，含共享工作区其他批次测试 |
| `pnpm tauri build --bundles app` | 通过，release 5.31MiB |

原生调试包标识 `com.mingzaily.tandem.tool-status-audit`。临时 ZDOTDIR 注入替身 CLI，项目、会话与队列独立存放。使用 TANDEM_DRIVE_SCRIPT 点击页面入口和切换主题，截图只截目标窗口。

实际经过后端接收 ToolUse，页面运行行显示完整工具名；MCP 工作记录主行只显示服务器和工具名，悬停标题包含查询，点击展开可以看到完整 query。收到工具结果后，运行行恢复“正在思考…”。长工具名在 720×480 下省略，状态行保持 32px、页面宽与 scrollWidth 均为 720px，右侧耗时边缘位于 702px。

以下四张最终目标窗口截图均已逐张查看：

| 逻辑窗口 | 浅色 | 深色 |
|---|---|---|
| 1200×800 | [MCP 主行与展开输入](assets/tool-status/mcp-row-light.png) | [MCP 主行与运行提示](assets/tool-status/mcp-row-dark.png) |
| 720×480 | [长名称与右侧耗时](assets/tool-status/mcp-narrow-light.png) | [长名称与右侧耗时](assets/tool-status/mcp-narrow-dark.png) |

四张图均保留原生窗口完整尺寸；没有图像裁切或缩放。结构化通过记录见 [checks.json](assets/tool-status/checks.json)。并行乱序、确认优先与右侧 Token 文案有单元测试覆盖；本批原生截图的替身没有产生 Token 用量。

## 自审、性能与边界

- **业务逻辑：** 检查当前轮边界、工具结果关联、并行完成顺序、确认优先、思考与回复切换、参数完整性；修复后审查通过。
- **代码设计：** 运行状态与工作记录分别格式化同一工具事件；MCP 展示使用小型纯函数，复用既有行结构和 token；动画依赖显示文字及活动计数，避免状态对象身份变化重放。审查通过。
- 没有新增依赖、后台进程或网络请求。当前共享构建入口 429.59kB / gzip 129.70kB，包含其他批次改动；本批没有重新抽样启动耗时与常驻内存，前批指标保留在[性能记录](2026-11-06-final-review.md)。
- 未请求真实模型或 MCP 服务。Claude 的替身经过完整原生事件链，Codex/Pi 保留现有工具名适配，本批未逐个连接真实服务。
- 测试页面 localStorage 在前后备份恢复并核对；测试会话、项目、队列和隔离窗口清理。四份 CLI 配置 SHA-256 保持一致；本批只关闭隔离验收窗口。
