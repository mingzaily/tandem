# Agent 配置清单

> **状态**：权威
> **读取时机**：修改设置页的 MCP、Skills 或配置来源读取之前

设置页按 Claude Code、Codex、Pi 分区，显示全局及所选项目的 MCP 服务器和 Skills。清单表示文件中配置的资源；连接、启用、项目可信状态与实际加载由 CLI 管理。进入设置前的任务工作目录作为当前项目，用户也可在清单上方选择已添加的项目或只查看全局。

## 文件位置

| CLI | 全局 MCP | 项目 MCP | Skills |
|---|---|---|---|
| Claude Code | 默认 `~/.claude.json` 的 `mcpServers`；同文件 `projects[工作目录].mcpServers` 属于当前项目 | 项目 `.mcp.json` 的 `mcpServers` | `~/.claude/skills/`、项目 `.claude/skills/` |
| Codex | `$CODEX_HOME/config.toml`，默认 `~/.codex/config.toml` 的 `mcp_servers` | 项目 `.codex/config.toml` 的 `mcp_servers`，CLI 在可信项目中加载 | `~/.agents/skills/`、项目及仓库内上级目录的 `.agents/skills/`；同时展示 `$CODEX_HOME/skills/` 和项目 `.codex/skills/` 中的本机技能 |
| Pi | 内置 MCP：`$PI_CODING_AGENT_DIR/mcp.json`，默认 `~/.pi/agent/mcp.json` 的 `mcpServers`。用户包含 `npm:pi-mcp-adapter` 时按适配器读取：`~/.config/mcp/mcp.json`、`~/.agents/mcp.json`、`~/.agents/mcp/mcp.json`、`~/.pi/agent/mcp.json`、`~/.pi/agent/mcp-adapter.json`，后读的同名服务器覆盖先读的 | 内置 MCP：项目 `.pi/mcp.json`。适配器：工作目录的 `.mcp.json`、`.pi/mcp.json`、`.pi/mcp-adapter.json` | `~/.pi/agent/skills/`、项目 `.pi/skills/`、共享的 `~/.agents/skills/` 和项目 `.agents/skills/`；另读两级 `settings.json` 的显式 `skills` 路径 |

Claude 设置了 `CLAUDE_CONFIG_DIR` 时，技能根目录改为该目录，MCP 文件位于 `$CLAUDE_CONFIG_DIR/.claude.json`。这个文件与默认位置 `~/.claude.json` 的相对位置不同，读取时分别处理。

项目资源从当前工作目录向上寻找，遇到仓库 `.git` 目录或 worktree 的 `.git` 文件后停止。Pi 的额外技能路径分别相对于用户 Agent 目录、项目 `.pi` 目录解析，支持绝对路径与 `~/`。清单读取技能 front matter 的名称与描述，支持 YAML 引号、多行和折叠标量；目录名提供未声明名称时的名称。符号链接按真实路径去重，目录循环只访问一次。

本机 Pi 的内置 MCP 配置与技能位置已对照安装包 `@earendil-works/pi-coding-agent` 1.5.0 的 `docs/mcp.md`、`docs/skills.md`、`docs/settings.md` 和 `dist/core/skills.js`。旧版 Pi 或替换内置 MCP 的扩展沿用自身的加载方式。清单读取上述静态文件与技能根目录，插件包、扩展动态注册、额外启动参数和托管配置的资源由各 CLI 自己展示。

## npx skills 来源

- 全局锁默认是 `~/.agents/.skill-lock.json`；设置了 `XDG_STATE_HOME` 时使用 `$XDG_STATE_HOME/skills/.skill-lock.json`。
- 项目锁是 `<项目>/skills-lock.json`，不是 `.agents/` 下的文件。位置和 `source` 字段已核对 `vercel-labs/skills` 的 `src/local-lock.ts`、`src/skill-lock.ts`。
- 技能名称或安装目录名出现在同级锁文件的 `skills` 映射中时，标记“npx skills 管理”，使用 `source` 展示来源仓库。手工技能保留自己的名称与描述。

## 读取边界

读取集中在 Rust `agent_resources.rs` 的阻塞线程。页面只取得名称、传输类型、命令、作用域、配置路径、技能描述和仓库来源。命令参数、环境变量、请求头、登录文件和技能正文保持在页面之外。配置文件上限 4 MB，单个技能文件上限 1 MB。语法错误只报告文件路径和位置，原文件保持原样。

文件缺失表示该位置尚未配置资源；IO、JSON、TOML 和技能元数据错误显示在所属 CLI 的对应分区，其他分区继续显示。清单只读，页面没有编辑、删除、重连和写回 CLI 配置的操作。读取一次返回三种 CLI 的结果，前端按需加载并虚拟化长清单。

测试使用临时目录。调试包的 `TANDEM_DRIVE_RESOURCE_HOME` 可替换共享资源的用户根目录；结合 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`PI_CODING_AGENT_DIR` 和 `TANDEM_DRIVE_DATA_DIR`，隔离验收的全部输入与应用数据。正式版包含常规配置读取，不包含该测试覆盖入口。

## 依据

- [Claude Code MCP 作用域](https://code.claude.com/docs/en/mcp#choose-the-right-scope)、[Skills 目录](https://code.claude.com/docs/en/skills#where-skills-live)、[配置目录](https://code.claude.com/docs/en/claude-directory)。
- [OpenAI MCP 配置](https://developers.openai.com/codex/mcp)、[Skills 位置](https://learn.chatgpt.com/docs/build-skills)。
- [skills 项目锁源码](https://github.com/vercel-labs/skills/blob/main/src/local-lock.ts)、[全局锁源码](https://github.com/vercel-labs/skills/blob/main/src/skill-lock.ts)。

## Pi 的 MCP 来源

Pi 的 `settings.json`（全局和项目 `.pi/`）决定显示哪一套来源：

- `packages` 里有 `pi-mcp-adapter`：按适配器 `config.ts`（7.0.1）的来源和顺序读取，见上表。适配器配置里的 `imports`（如 `claude-code`、`codex`）只列出名称，不展开别家的配置。没有读取 `settings.ancestorConfigRoots` 开启的上级目录，也不处理 `PI_MCP_CONFIG_MODE=exclusive`，这两项只影响 Pi 进程自己的环境。
- 没有适配器、`extensions` 也没有 `-builtin:mcp`：读取内置 MCP 的 `mcp.json`。
- 没有适配器且内置 MCP 已停用：不列服务器，显示“Pi 内置 MCP 已停用”。


适配器的 `imports` 按它的 `IMPORT_PATHS` 展开：Claude Code 依次找 `~/.claude/mcp.json`、`~/.claude.json`、`~/.claude/claude_desktop_config.json`，Codex 找 `~/.codex/config.toml`、`config.json`，Cursor、Windsurf、Claude Desktop 和项目里的 `.vscode/mcp.json` 同理，每种只读第一个存在的文件。导入的条目优先级最低：适配器自己的同名配置覆盖它，先列的导入覆盖后列的。界面在条目后标“导入自 Claude Code”等。经适配器加载的条目都标 `provider: pi-mcp-adapter`，分组标题写成“pi-mcp-adapter · 全局配置”，与 Pi 自己读取的条目分开。OpenCode 会合并多个文件，没有展开，仍以说明列出。
## 设置页的展示

Agent 设置页对照参考 `ProvidersSection.tsx` 的供应商页：一张卡片，左边 224px 窄栏列出 Claude Code、Codex、Pi（28px 头像、名称、状态注记、就绪圆点），右边是所选 CLI 的详情。详情头固定（36px 头像、版本与登录状态、安装或登录按钮），下面是“在任务列表中显示”开关，再往下是可滚动的清单：吸顶工具行放 MCP 服务器 / Skills 分段切换（带数量）、项目选择和搜索框，列表按“当前项目”“全局配置”分组，组头可折叠，每行一个图标、名称和一行说明（对照 `UnifiedModelList.tsx` 的分组与单行模型行）。项目选择只列真实目录，“对话”没有项目级配置，不列出。

“在任务列表中显示”写入 `config.toml` 的 `hidden_task_agents`。关闭后桌面侧栏和手机端都不列出这个 CLI 的任务，也不扫描它的会话文件；登录状态、MCP 和 Skills 照常读取。适合习惯在 Codex App 等官方客户端里使用某个 CLI 的情况。

