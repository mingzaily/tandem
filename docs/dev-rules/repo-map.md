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

## 历史引用

仓库保留了旧代码的 Git 引用，不会被推送到远端：

| 引用 | 内容 |
|---|---|
| `refs/legacy/tandem` | Electron 版 tandem（Cindy 的轻 fork）最后的提交 |
| `refs/loom/main` | 更早的深 fork loom，包含原生会话方案 |
| `refs/cindy/v0.1.121` | fork 基线 |

```bash
git log --oneline refs/legacy/tandem
git show refs/loom/main:docs/loom/b8-plan.md
git show refs/legacy/tandem:apps/desktop/src/renderer/components/chat/UserMessage.tsx
```

这些历史来自 partial clone：tandem 和 loom 自己的提交内容都在本地，部分 Cindy 旧文件在第一次读取时才从 `cindy` 远端下载，需要 GitHub 的 SSH 权限。

### 备份

- `refs/loom/main` 已推送到私有仓库。新克隆用 `git fetch origin refs/loom/main:refs/loom/main` 取回。
- `refs/legacy/tandem` 只有 14 个提交是自己的，其余是 Cindy 的公开历史。完整推送要先下载约 8 万个文件，所以这 14 个提交以 bundle 形式放在私有仓库的 Release `legacy-refs` 里。恢复时先取到基线 `v0.1.121`，再执行：

```bash
git fetch git@github.com:makecindy/cindy.git refs/tags/v0.1.121:refs/cindy/v0.1.121
git bundle unbundle legacy-tandem.bundle
git update-ref refs/legacy/tandem e7a3f25ace
```
