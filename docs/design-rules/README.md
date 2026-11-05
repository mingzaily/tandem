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
| `Composer.tsx` | `components/new-chat/ChatInput.tsx`、`SendButton.tsx` |

## 不复刻的内容

Cindy 的名称、Logo、角色形象和宣传图不在 Apache-2.0 许可范围内。应用图标用 [`docs/brand/tandem-icon.svg`](../brand/tandem-icon.svg)，标记用 `tandem-mark.svg`。

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
