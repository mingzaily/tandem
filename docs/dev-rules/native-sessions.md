# 原生会话

> **状态**：权威
> **读取时机**：读写任务数据、接入新 CLI 之前

各 CLI 的文件格式对照和早期设计见 [`reference/loom/architecture.md`](../reference/loom/architecture.md)，当时踩过的坑见同目录的其他文档，ccgui 的做法可以查 `docs/reference/repos/ccgui`。

## Claude Code

**位置**：`$CLAUDE_CONFIG_DIR/projects/<编码后的目录>/<uuid>.jsonl`，默认是 `~/.claude`。不要用工作目录去计算编码后的目录名，超长路径会对不上，要扫描目录。工作目录从文件内容的 `cwd` 字段读取。

**任务列表**：只读文件开头（`cwd`、首条提示词）和结尾 256 KB（标题）。标题优先级：`custom-title`、`ai-title`、首条提示词。

**消息内容**：

- 只取 `user` 和 `assistant` 行，跳过 `isSidechain`（子 Agent）和 `isMeta`。
- 回退（rewind）会在文件里留下废弃分支。要从最新一行沿 `parentUuid` 回溯，压缩后沿 `logicalParentUuid` 继续。
- 并行工具调用不全在这条链上：同一 `message.id` 的其他内容块和对应的 `tool_result` 要补回来。
- CLI 把部分内部信息写成用户文本，比如 `<local-command-*>`、`<command-name>`、`<task-notification>` 和 `[Request interrupted by user…]`，显示前要转换。
- 解析失败的行要跳过，文件结尾可能有半行。

**体积控制**：工具输出每条截断到 20 KB，工具输入的每个字符串截断到 4 KB，并保持 JSON 有效。

**驱动**：

```bash
claude -p --input-format stream-json --output-format stream-json \
  --verbose --include-partial-messages \
  --permission-prompt-tool stdio \
  --session-id <新 uuid>   # 新任务
  --resume <uuid>          # 续接
```

`parent_tool_use_id` 不为空的输出属于子 Agent，主对话不显示。权限被拒绝的工具在 `result.permission_denials` 里。

新任务勾选 worktree 时加 `--worktree`。CLI 在 `<项目>/.claude/worktrees/<名字>` 下创建 worktree，任务的 `cwd` 就是这个目录，任务文件也在它对应的项目目录里。续接时从任务文件读 `cwd`，不用再传这个参数。侧栏按 `/.claude/worktrees/` 之前的路径归到原项目。

运行期间 stdin 保持打开，用来回复工具授权和提问，收到 `result` 后关闭，进程随之退出。

模型列表和套餐用量来自一个不发提示词的短进程（`cli_info::read`），每次启动查一次：发送 `initialize` 和 `get_usage` 控制请求，带 `--no-session-persistence`，不产生会话文件，也不请求模型。用户级的 hook 仍会运行。运行中的用量从 `rate_limit_event` 更新。

上下文占用取活跃分支上最后一次请求的输入 token。窗口大小只在 `result` 的 `modelUsage` 里有，按模型缓存在本地，所以这个模型跑完一轮后才显示圆环。

**单写入者**：`<配置目录>/sessions/<pid>.json` 列出运行中的会话（`pid`、`sessionId`、`status`、`entrypoint`）。`-p` 进程也会登记，`status` 是 `busy` 或 `idle`，退出后文件消失，崩溃时会留下，所以要确认进程还活着（`writers.rs`）。`entrypoint` 为 `cli` 是终端，`sdk-cli` 是其他程序。Tandem 自己的轮次不算外部写入者。页面每 5 秒看一次，只在窗口可见时看；发送前后端再查一次，防止这 5 秒里有变化。

## Codex

全部通过 `codex app-server`（stdio 上的 JSON-RPC，`codex.rs`），不解析它的文件：`.zst` 压缩和分叉拼接都由它处理。协议类型可以用 `codex app-server generate-json-schema --out <目录>` 按已安装版本生成。

**读取**：`thread/list`（`useStateDbOnly`，`sourceKinds` 去掉子 Agent）、`thread/items/list`（倒序分页）、`model/list`、`account/rateLimits/read`。这个进程没有加载线程，不持有写入锁，空闲 60 秒退出。

**分叉断链的例外**：分叉出来的任务，父任务的 rollout 不在了时，`thread/items/list` 会报 `invalid paginated history lineage … missing source rollout`。这时只读它自己的 rollout（`event_msg` 里的 `item_completed`，字段形状和官方接口不同，由 `normalized_item` 转换），分叉之前的历史缺失，分叉之后的内容正常显示。这是上面"不解析它的文件"唯一的例外，只在这个报错时走。

**运行**：`initialize` → `thread/start` 或 `thread/resume` → `turn/start`，然后处理 `item/*` 通知，到 `turn/completed` 为止（失败也是它，看 `turn.status`）。之后结束进程释放锁。还没跑过一轮的线程没有 rollout，不能 resume。

**请求**：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/tool/requestUserInput` 显示成卡片。其他请求也要回复，否则这一轮会一直等。

**转换**：`commandExecution`、`fileChange` 等转成和 Claude 一样的工具消息，界面共用一套。命令外层的 `/bin/zsh -lc` 要去掉。

**单写入者**：`thread-writer-locks/<id>.lock` 被 flock 持有就是开在别处。Codex 会直接拒绝续接，所以不提供"仍要发送"。

## Pi

**位置**：`$PI_CODING_AGENT_DIR/sessions/--<工作目录>--/<时间>_<uuid>.jsonl`，默认是 `~/.pi/agent`。只读顶层文件，里面的子目录是子 Agent 的运行记录。有的文件是符号链接，要按真实路径去重。第一行是 `session` 头，带 `cwd`。

**消息内容**：每条有 `id` 和 `parentId`，最后一条就是当前位置，沿父节点回溯得到当前分支。角色是 `user`、`assistant`、`toolResult`。标题优先取最后一条 `session_info.name`，其次是首条提示词。

**驱动**：`pi --mode rpc`（`--session <路径>` 续接，`--session-id <uuid>` 新建），每轮一个进程。发 `prompt`，处理事件，到 `agent_settled` 为止，然后关闭 stdin 让它写完退出。停止发 `abort`。

**模型列表**：`pi --mode rpc --no-session --no-extensions`，0.3 秒，不连用户的 MCP。带扩展启动要 2.8 秒。

**对话框**：扩展的 `confirm`、`select`、`input`、`editor` 显示成卡片，其他 `extension_ui_request` 只影响它自己的显示，忽略。

## 已知限制

见 [路线图](../roadmap.md)。见文件。

## 压缩

CLI 压缩对话时写的摘要是给模型看的，不显示内容，页面只画一条“对话已压缩”分隔线（`MessageKind::Compaction`）。来源：Claude 的 `isCompactSummary` 行，这行也不能当标题；Codex 的 `contextCompaction` 条目；Pi 的 `compaction` 条目。

## 默认推理强度

用户没选强度时不传参数，由 CLI 自己决定，但页面要显示实际的级别，不写“默认”两个字了事。每个模型的来源：

- Claude：`initialize` 不报。对每个模型依次发 `set_model`、`get_settings`，读 `applied.effort`。要等上一条的回复再发下一条，否则读到的是上一个模型的。这个切换只在这个临时进程里，不落盘。
- Codex：`config/read` 的 `model_reasoning_effort`，模型支持时优先；否则用 `model/list` 的 `defaultReasoningEffort`。
- Pi：`get_state` 的 `thinkingLevel`，模型支持时才算。

读不到时滑块多一档“默认”。滑到模型自己的默认档等于不选，CLI 的配置继续生效。

## 接入新 CLI 时

先确认它的官方接口和实际文件格式，写进本文件，再实现。读取和驱动都要有基于构造数据的测试。

## 附件

用户消息里的图片块原样读给页面显示。CLI 会另写一条 `isMeta` 的 `[Image: source: …]`，跟其他 `isMeta` 行一样隐藏。附件文件保存为提示词末尾的 `Attached file, readable with your tools even outside the workspace: 路径` 行，页面读回来显示成文件标签，生成标题时跳过。这句话要明说文件读得到：写成 `Attached file: 路径` 时，Codex 的低推理强度模型常常不去读，直接说读不到。
