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
  --verbose --include-partial-messages --replay-user-messages \
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

**是否在运行**：写入锁只说明线程开着。看 rollout 末尾最后一个回合标记：`task_started` 是运行中，`task_complete`、`turn_aborted` 是结束。不能用最后写入时间判断，Codex 等长回复时不写文件。末尾 4 MB 里没有标记时才退回看最近写入，超过 30 分钟没写入的按卡死算。

**单写入者**：`thread-writer-locks/<id>.lock` 被 flock 持有就是开在别处。Codex 会直接拒绝续接，所以不提供"仍要发送"。

## Pi

**位置**：`$PI_CODING_AGENT_DIR/sessions/--<工作目录>--/<时间>_<uuid>.jsonl`，默认是 `~/.pi/agent`。只读顶层文件，里面的子目录是子 Agent 的运行记录。有的文件是符号链接，要按真实路径去重。第一行是 `session` 头，带 `cwd`。

**消息内容**：每条有 `id` 和 `parentId`，最后一条就是当前位置，沿父节点回溯得到当前分支。角色是 `user`、`assistant`、`toolResult`。标题优先取最后一条 `session_info.name`，其次是首条提示词。

**驱动**：`pi --mode rpc`（`--session <路径>` 续接，`--session-id <uuid>` 新建），每轮一个进程。发 `prompt`，处理事件，到 `agent_settled` 为止，然后关闭 stdin 让它写完退出。停止发 `abort`。

**模型列表**：`pi --mode rpc --no-session --no-extensions`。先用 `get_available_models` 和 `get_state` 读取模型清单与当前默认模型，再在同一临时进程里逐个 `set_model`，用 `get_state`、`get_available_thinking_levels` 读取每个模型的实际默认值与可选档位，包括 `off`。RPC 的模型与强度切换默认 `persist: false`，只改变进程内状态；`--no-session` 保持原生任务文件原样。读取时关闭扩展，避免连接用户的 MCP。

**对话框**：扩展的 `confirm`、`select`、`input`、`editor` 显示成卡片，其他 `extension_ui_request` 只影响它自己的显示，忽略。

## 已知限制

见 [路线图](../roadmap.md)。见文件。

## 终端续接

任务菜单的“复制终端续接命令”先用 `cd -- <任务目录>` 切换目录，成功后用 `&&` 执行对应 CLI 的续接命令。目录取自原生任务的 `cwd`，worktree 任务使用其实际目录。目录和任务 ID 按 shell 单引号规则转义，保留空格、引号和特殊字符。

## 生成标题

任务菜单提供单个任务的“生成标题”。参考本机 pi-web 0.15.0 的实现：提取用户和助手文字，保留开头目标和最近结果，最多 6000 个字符；图片只保留标记，附件路径、工具输出和思考内容留在原记录中。沿用该 Agent 输入框当前选择的模型，选择模型支持的低推理强度，单独请求一个简短标题，90 秒超时。

标题生成运行在临时工作目录，工具和项目扩展关闭，生成过程保持独立：Claude 用 `--no-session-persistence`，Pi 用 `--no-session`，Codex 用 `ephemeral: true`，线程仍以 `sandbox: read-only` 启动。原任务的消息、运行状态和待发送队列保持各自生命周期。

模型返回的标题由 CLI 写入原生标题元数据：Claude 的 `rename_session` 控制请求、Codex 的 `thread/name/set`、Pi 的 `set_session_name`。Claude 和 Pi 在 Tandem 运行中时复用该任务的 stdin；空闲时短暂续接原任务，只发送改名请求，等待确认后退出。空闲元数据写入期间暂停队列领取，完成后恢复原来的队列状态；已暂停的队列保持暂停。Claude 开在其他程序中时要求先关闭该程序里的任务。

保存成功后清除原来的本地别名，界面采用原生标题。生成期间手动改过的别名继续生效。手动“重命名”仍属于 Tandem 的本地别名。标题生成和保存都通过后端命令提供，手机端操作名单保持原样。

Codex App 会把附件说明和用户输入封装成 `Files mentioned by the user` 与 `My request` 文本。读取时按完整封装结构提取正文，图片由独立图片块显示，普通文件转换为附件标签。普通 Markdown 和不完整封装保留原文。

## 运行中插入的消息

Tandem 的待发送队列由 `queue.rs` 管理。运行中发送先保存为本地草稿；当前轮正常结束、进程退出并释放原生任务后，才以新一轮交给 CLI。队列修改通过后端命令完成，附件和发送选项随条目保存。停止、出错和应用重启后，已有待发送消息保持暂停。队列为空且任务已空闲时，发送新消息直接开始新一轮。发送前不写原生会话文件，也不使用 CLI 自带的排队接口。

领取时把整条消息移到同一文件的 `inFlight` 字段并落盘；收到 CLI 接收回执后再删除。图片使用独立文件引用，发送前只读取当前条目的图片字节，同时生成 CLI 内容和发送气泡的独立预览；编辑和排序只改元数据。列表和 `inFlight` 都为空时删除 JSON，删除或确认接收后回收对应图片。旧内联格式在加载时迁移。接收前发生启动失败、拒收或退出时，条目回到队首并暂停。接收后的任务失败只暂停其余条目，已接收消息沿用 CLI 的会话记录。

| CLI | 接收回执 |
|---|---|
| Claude Code | `--replay-user-messages` 返回的主会话 `user` 消息，`isReplay: true`，`parent_tool_use_id` 为空。回显只用于确认，页面继续使用原用户消息 |
| Codex | `turn/start` 成功响应中的轮次 ID，或当前连接的 `turn/started` / `turn/completed` 通知 |
| Pi | ID 为 `prompt` 的成功 `response`；失败响应保留队首 |

`Started` 只用于界面与运行状态，可能早于子进程启动成功。是否放回队列按接收回执判断。接收确认属于后端内部信号，手机端事件协议保持原样。

应用重启后，残留 `inFlight` 回到队首，保留附件与发送选项，落盘为暂停状态，并提示“无法确定 CLI 是否已接收”。用户核对会话后决定删除或继续发送。普通待发送条目也保持重启暂停。队列清空后直接发送新消息时，`reserve` 清除旧的 `paused` 和 `error` 并落盘，使运行中再次入队的消息可在本轮成功后续发。

“仍要发送”只适用于当次立即发送尝试，`ignoreExternalWriter` 只作输入参数，队列文件保持省略。运行中入队、在已有消息后入队、显式恢复、重启和发送前失败后的重试都重新检查写入者；任务开在别处时暂停并显示原因。模型、强度与权限模式继续使用入队快照。

单个队列文件读取、解析或任务 ID 校验失败时，改名为带唯一后缀的 `.corrupt` 文件并保留内容；隔离失败时保留原路径。`queue-error` 带所属任务 ID，无法识别时为 `null` 并显示全局提示。其余队列继续加载，发送流程继续可用。页面先注册队列变化与错误监听，再请求初始列表。

用户在 CLI 运行时输入的内容，Claude 写成 `attachment` 行：`attachment.type` 是 `queued_command`，`humanTurn` 为真才是用户写的，内容在 `prompt`（字符串或内容块）。程序排队的命令同样走这里，不显示。文字里的 `[Image #3]` 是终端的占位，读取时去掉。

队列和输入框共用一张卡片，列表直接起排，折叠入口作为列表末行。任务状态行放在整张卡片上方：运行时显示活动与耗时/Token；队列暂停时显示 Pause、“任务已停止，队列暂停”和右侧的“继续发送”。行操作默认隐藏，进入队列区时全体浅显，聚焦行继续可见，显示切换保留固定占位。拖动把手支持方向键、Home、End 排序。折叠只控制可见范围；“移到队首”只改变待发送顺序，当前轮沿用自己的执行周期。

## 每轮文件编辑摘要

每轮结束后，在该轮消息末尾显示“文件已更改”内嵌卡片。下一轮开始后，历史卡片保留在所属轮次。摘要只汇总该轮真实用户消息之后成功完成的 `Edit`、`MultiEdit`、`Write`、`NotebookEdit`；工具结果消息、中断提示和压缩分隔保持在同一轮。当前运行轮的工具继续显示进度，结束后生成卡片。路径按任务工作目录归一后去重，读取、运行中工具和失败的修改保持原样出现在工作记录中。

卡片对照 Cindy 的 `TurnChangesCard.tsx`，默认展示 3 个文件，支持展开与收起。文件名置前，目录使用次要文字，完整路径通过悬停查看；展开后的长清单虚拟化，展开状态由消息流保存。

行数只使用原生适配层明确提供的 `added`、`removed`，按各次补丁累计，表示编辑量。替换片段、整文件写入内容和被截断的记录无法提供完整差异；任一文件缺少行数时，聚合胶囊只显示文件数。此摘要属于原生工具记录的派生视图，命令工具产生的文件修改仍从工作记录查看。

## 压缩

CLI 压缩对话时写的摘要是给模型看的，不显示内容，页面只画一条“对话已压缩”分隔线（`MessageKind::Compaction`）。来源：Claude 的 `isCompactSummary` 行，这行也不能当标题；Codex 的 `contextCompaction` 条目；Pi 的 `compaction` 条目。

## 默认推理强度

用户没选强度时不传参数，由 CLI 自己决定，但页面要显示实际的级别，不写“默认”两个字了事。每个模型的来源：

- Claude：`initialize` 不报。对每个模型依次发 `set_model`、`get_settings`，读 `applied.effort`。要等上一条的回复再发下一条；切换失败的模型保持默认值未知，避免把前一个模型的强度赋给它。这个切换只在这个临时进程里，不落盘。
- Codex：`config/read` 的 `model_reasoning_effort`，模型支持时优先；否则用 `model/list` 的 `defaultReasoningEffort`。
- Pi：逐个在临时进程切换模型后读 `get_state.thinkingLevel`，由 CLI 应用每个模型的配置与能力映射。可选档位来自 `get_available_thinking_levels`。

读不到时滑块多一档“默认”。滑到模型自己的默认档等于不选，CLI 的配置继续生效。

模型、权限、项目、上下文菜单和生成速度卡片挂载到页面顶层，共用触发器窗口坐标定位，跟随滚动与窗口大小变化。模型菜单固定向上展开，空间不足时压缩列表高度并在列表内滚动；其他弹层按可用空间切换方向。输入区的滚动容器保持独立。

三种 CLI 的默认模型来自各自的原生模型元数据。菜单在对应模型旁显示“默认”标签，当前选中项用行高亮表示。选择默认模型保存 `model: null`，后续继续跟随 CLI 的配置；选择其他模型只保存 Tandem 的发送选项。已解析的默认别名与真实模型合成一行；默认 ID 尚未解析时保留“跟随 CLI 配置”一行。CLI 没有报告默认模型时保持未知。

模型菜单显示读取状态和失败原因，失败时明确标识缓存，提供“刷新模型”。三种 Agent 在新任务的模型菜单中各有入口，空列表显示指引。中文强度名称区分 `xhigh`（超高）、`max`（最高）、`ultra`（极限）。只有一个可用档位时显示文字。

## 接入新 CLI 时

先确认它的官方接口和实际文件格式，写进本文件，再实现。读取和驱动都要有基于构造数据的测试。

## 附件

用户消息里的图片块原样读给页面显示。CLI 会另写一条 `isMeta` 的 `[Image: source: …]`，跟其他 `isMeta` 行一样隐藏。附件文件保存为提示词末尾的 `Attached file, readable with your tools even outside the workspace: 路径` 行，页面读回来显示成文件标签，生成标题时跳过。这句话要明说文件读得到：写成 `Attached file: 路径` 时，Codex 的低推理强度模型常常不去读，直接说读不到。
