# 仓库地图

> **状态**：权威
> **读取时机**：找代码入口，或新增模块决定放哪里之前

## 桌面端 `desktop/`

| 路径 | 职责 |
|---|---|
| `src/App.tsx` | 应用状态：任务列表、当前选择、运行中的轮次、通知 |
| `src/components/Sidebar.tsx` | 侧边栏：新建、搜索、项目分组、任务行 |
| `src/components/MessageStream.tsx` | 对话区：虚拟列表、工作组、工具行、思考行。按需加载 |
| `src/components/Markdown.tsx` | Markdown 和代码高亮。随对话区按需加载 |
| `src/components/Composer.tsx` | 输入框、项目选择、发送和停止 |
| `src/lib/api.ts` | Tauri 命令和事件的类型与调用，页面只从这里访问后端 |
| `src/lib/items.ts` | 消息转界面行、实时事件合并、工作组折叠规则 |
| `src/lib/tools.ts` | 工具行的动词和参数、摘要、时间格式 |
| `src/lib/i18n.ts` | 文案，只有 `zh-CN` 和 `en` |
| `src-tauri/src/commands.rs` | 暴露给页面的 Tauri 命令 |
| `src-tauri/src/sessions.rs` | 只读解析 Claude 原生会话文件 |
| `src-tauri/src/runner.rs` | 启动 `claude`，解析流式输出，停止任务 |
| `src-tauri/src/login_env.rs` | 读取登录 shell 的环境变量 |
| `src-tauri/src/harness.rs` | 仅调试版：用脚本驱动页面 |
| `design/tokens/` | 设计 token |

## 其他目录

- `pwa/`、`relay/`：见各自的 README。
- `docs/`：见 [文档索引](../README.md)。
- `docs/brand/`：应用图标和标记的源文件。
- `docs/reference/`：历史文档和本地参考仓库。

## 参考仓库

`docs/reference/repos/` 放 Cindy 和 ccgui 的代码，供实现时查阅，已被 Git 忽略，不会上传。说明见 [参考资料](../reference/README.md)。
