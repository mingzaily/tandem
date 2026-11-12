# 原生会话

> **状态**：权威
> **读取时机**：读写任务数据、接入新 CLI 之前

各 CLI 的文件格式对照和早期设计见 [`reference/loom/architecture.md`](../reference/loom/architecture.md)，当时踩过的坑见同目录的其他文档，ccgui 的做法可以查 `docs/reference/repos/ccgui`。

## Claude Code

**位置**：`$CLAUDE_CONFIG_DIR/projects/<编码后的目录>/<uuid>.jsonl`，默认是 `~/.claude`。不要用工作目录去计算编码后的目录名，超长路径会对不上，要扫描目录。工作目录从文件内容的 `cwd` 字段读取。

**任务列表**：从文件开头读 `cwd` 和首条提示词；标题从末尾按块向前查找原生元数据，保留各类最后一条记录，优先级为 `custom-title`、`ai-title`、首条提示词。已保存标题在后续持续对话及应用重启后继续生效，读取只保留当前块和跨块的一行；Claude 找到最新自定义标题后停止，否则查找完整元数据以确定生成标题的优先级。

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

模型列表和套餐用量来自一个不发提示词的短进程（`cli_info::read`），每次启动查一次：发送 `initialize` 和 `get_usage` 控制请求，带 `--no-session-persistence`，不产生会话文件，也不请求模型。用户级的 hook 仍会运行。运行中的用量从 `rate_limit_event` 更新。终端里的用量 Tandem 收不到，所以窗口过了重置时间会再读一次（失败后至少隔 5 分钟重试），每轮结束后、菜单栏面板打开时，若额度超过 3 分钟没更新就重读（对照参考 `claudeSubscriptionUsageRefresh.ts` 的 3 分钟节流；参考另有响应头旁路，Tandem 不代理请求，没有这一路）。

Claude 在每条用户记录上写 `permissionMode`。读取任务时取活动分支上最后一个值，输入框在这个任务里按它显示和发送（`default` 对应“默认权限”，plan 等没有对应选项的不跟随）；在 Tandem 里改过的以改过的为准，只保存在内存。这样续接终端里用 auto 跑的任务时不会退回逐条确认。

上下文占用取活跃分支上最后一次请求的输入 token。窗口大小只在 `result` 的 `modelUsage` 里有，按模型缓存在本地，所以这个模型跑完一轮后才显示圆环。

**单写入者**：`<配置目录>/sessions/<pid>.json` 列出运行中的会话（`pid`、`sessionId`、`status`、`entrypoint`）。`-p` 进程也会登记，`status` 是 `busy` 或 `idle`，退出后文件消失，崩溃时会留下，所以要确认进程还活着（`writers.rs`）。`entrypoint` 为 `cli` 是终端，`sdk-cli` 是其他程序。Tandem 自己的轮次不算外部写入者。页面每 5 秒看一次，只在窗口可见时看；发送前后端再查一次，防止这 5 秒里有变化。

## Codex

全部通过 `codex app-server`（stdio 上的 JSON-RPC，`codex.rs`），不解析它的文件：`.zst` 压缩和分叉拼接都由它处理。协议类型可以用 `codex app-server generate-json-schema --out <目录>` 按已安装版本生成。

**读取**：`thread/list`（`useStateDbOnly`，`sourceKinds` 去掉子 Agent）、`thread/turns/list`（`itemsView: full`，倒序分页，同时读取轮次终态与错误）、`model/list`、`account/rateLimits/read`。这个进程没有加载线程，不持有写入锁，空闲 60 秒退出。

**分叉断链的例外**：分叉出来的任务，父任务的 rollout 不在了时，历史分页会报 `invalid paginated history lineage … missing source rollout`。这时只读它自己的 rollout（`event_msg` 里的 `item_completed`，字段形状和官方接口不同，由 `normalized_item` 转换），分叉之前的历史缺失，分叉之后的内容正常显示。这是上面"不解析它的文件"唯一的例外，只在这个报错时走。

**运行**：`initialize` → `thread/start` 或 `thread/resume` → `turn/start`，然后处理 `item/*` 通知，到 `turn/completed` 为止（失败也是它，看 `turn.status`）。之后结束进程释放锁。还没跑过一轮的线程没有 rollout，不能 resume。

**请求**：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/tool/requestUserInput` 显示成卡片。提问中的 `isOther` 归一化为页面的 `allowCustom`，控制自定义回答入口；回复继续按原始问题 ID 编码。其他请求也要回复，否则这一轮会一直等。

**转换**：`commandExecution`、`fileChange` 等转成和 Claude 一样的工具消息，界面共用一套。命令外层的 `/bin/zsh -lc` 要去掉。

**是否在运行**：写入锁只说明线程开着。看 rollout 末尾最后一个回合标记：`task_started` 是运行中，`task_complete`、`turn_aborted` 是结束。不能用最后写入时间判断，Codex 等长回复时不写文件。末尾 4 MB 里没有标记时才退回看最近写入，超过 30 分钟没写入的按卡死算。

**单写入者**：`thread-writer-locks/<id>.lock` 被 flock 持有就是开在别处。ChatGPT 的 app-server 会在任务空闲时继续持有此锁；页面分别说明空闲或运行中，并指引在 ChatGPT 关闭任务或退出 ChatGPT。Codex 由自身锁保护单写入者，页面保持发送暂停。每 5 秒探测锁，释放后在当前任务自动清除提示、恢复发送并重新读取历史。

## Pi

**位置**：`$PI_CODING_AGENT_DIR/sessions/--<工作目录>--/<时间>_<uuid>.jsonl`，默认是 `~/.pi/agent`。只读顶层文件，里面的子目录是子 Agent 的运行记录。有的文件是符号链接，要按真实路径去重。第一行是 `session` 头，带 `cwd`。

**消息内容**：每条有 `id` 和 `parentId`，最后一条就是当前位置，沿父节点回溯得到当前分支。角色是 `user`、`assistant`、`toolResult`。标题从末尾按块向前读取，取最后一条 `session_info.name`，其次是首条提示词；标题记录可位于文件的任意位置。最新名称为空时，按 Pi 原生语义清空标题，回退到首条提示词。Pi 缩放图片后会在提示词末尾追加 `[Image: original …, displayed at …. Multiply coordinates by … to map to original image.]`。读取带图片的用户消息时只去掉该固定格式的尾部坐标说明，保留用户正文和图片，文本中的引用与普通无图消息保持原文。标题与历史显示使用同一份正文，实时消息与历史消息因此按相同正文合并，显示一条。

**驱动**：`pi --mode rpc`（`--session <路径>` 续接，`--session-id <uuid>` 新建），每轮一个进程。发 `prompt`，处理事件，到 `agent_settled` 为止，然后关闭 stdin 让它写完退出。停止发 `abort`。单次 `message_end` 的 `error` 记录当前请求失败；Pi 后续重试以 `stop`、`toolUse` 或 `length` 成功完成时清除此失败状态。整轮结果以 `agent_settled` 时最后一次请求的状态为准，已恢复的请求继续按成功轮次处理队列。

**模型列表**：`pi --mode rpc --no-session --no-extensions`。先用 `get_available_models` 和 `get_state` 读取模型清单与当前默认模型，再在同一临时进程里逐个 `set_model`，用 `get_state`、`get_available_thinking_levels` 读取每个模型的实际默认值与可选档位，包括 `off`。RPC 的模型与强度切换默认 `persist: false`，只改变进程内状态；`--no-session` 保持原生任务文件原样。读取时关闭扩展，避免连接用户的 MCP。

**外部运行与单写入者**：Pi 没有原生会话写锁或 PID 注册文件。Tandem 在已有写入者轮询里识别显式使用 `--session <路径或完整 UUID>`、`--session-id <UUID>` 的存活 Pi 进程。macOS 通过内核读取完整 argv，保留路径空格，只解析参数区，不输出进程环境。会话经过原生发现目录校验，符号链接按真实文件匹配，界面任务 ID 沿用发现文件名的 UUID。运行状态由最后一条有效用户、工具结果或助手终止记录判断；工具结果后仍等待模型时保持运行中，`stop`、`length`、`error`、`aborted` 表示空闲。页面复用现有外部占用提示和文件变化跟随，进程结束后重读最终内容。发送前后端再次检查，用户明确选择“仍要发送”时沿用当次覆盖规则。

这一路只识别进程启动参数里明确给出的会话；通过交互式 `/resume`、`--continue` 或菜单切换的会话没有进程级会话标识，当前保持读取能力，外部占用状态仍有此范围限制。任务文件更新时间只用于触发内容重读，运行状态以存活进程及会话记录为依据。

**对话框**：扩展的 `confirm`、`select`、`input`、`editor` 显示成卡片，其他 `extension_ui_request` 只影响它自己的显示，忽略。`pi-ask-user` 把问题和背景按固定的 `\n\nContext:\n` 拼入 RPC 标题；宿主在主问题和背景都有效时增加 `Question.displayQuestion` 与 `context`，桌面和手机分别显示主问题、小号灰色的“背景说明”。`Question.question` 与原生请求中的问题保留完整原文，普通答案与自定义桥接继续用它作为匹配键。普通 `select` 归一化为 `allowCustom: false`，保留扩展完整选项。`pi-ask-user` 固定的 `✏️ Type custom response...` 选项由宿主识别为自由回答能力，页面使用本地化的“输入其他回答…”入口，打开输入和返回选项只保留本地草稿。提交时 `Decision::Answer.custom` 标明正文来自自由输入；宿主先回传固定原标签，再用正文自动回答同一问题的 `Type your answer...` 输入请求，原生 `select → input` 语义完整保留。桥接正文只在当前工具的内存中保存，工具结束时清除；其他标题、占位或普通选项仍走原生交互。`input`/`editor` 直接显示自由回答字段；扩展关闭自由回答时保持选项能力原样。

## 已知限制

见 [路线图](../roadmap.md)。见文件。

## 终端续接

任务菜单的“复制终端续接命令”先用 `cd -- <任务目录>` 切换目录，成功后用 `&&` 执行对应 CLI 的续接命令。目录取自原生任务的 `cwd`，worktree 任务使用其实际目录。目录和任务 ID 按 shell 单引号规则转义，保留空格、引号和特殊字符。

## 生成标题

任务菜单提供单个任务的“生成标题”。参考本机 pi-web 0.15.0 的实现：提取用户和助手文字，保留开头目标和最近结果，最多 6000 个字符；图片只保留标记，附件路径、工具输出和思考内容留在原记录中。沿用该 Agent 输入框当前选择的模型，选择模型支持的低推理强度，单独请求一个简短标题，90 秒超时。

标题生成运行在临时工作目录，工具和项目扩展关闭，生成过程保持独立：Claude 用 `--no-session-persistence`，Pi 用 `--no-session`，Codex 用 `ephemeral: true`，线程仍以 `sandbox: read-only` 启动。原任务的消息、运行状态和待发送队列保持各自生命周期。

模型返回的标题由 CLI 写入原生标题元数据：Claude 的 `rename_session` 控制请求、Codex 的 `thread/name/set`、Pi 的 `set_session_name`。Claude 和 Pi 在 Tandem 运行中时复用该任务的 stdin；空闲时短暂续接原任务，只发送改名请求，等待确认后退出。空闲元数据写入期间暂停队列领取，完成后恢复原来的队列状态；已暂停的队列保持暂停。空闲改名进程按实际 PID 登记为 Tandem 自有元数据进程，写入者检测仅过滤这个进程，其他程序打开同一任务时仍保留保护。该进程保持独立于对话运行状态；这段短暂写入期间到来的立即发送请求等待元数据进程退出，再重新领取任务，沿用真正运行任务的互斥检查；等待期间停止发送会取消该次等待，消息保留在草稿中。Claude 开在其他程序中时要求先关闭该程序里的任务。

保存成功后清除原来的本地别名，界面采用原生标题。生成期间手动改过的别名继续生效。手动“重命名”仍属于 Tandem 的本地别名。标题生成和保存都通过后端命令提供，手机端操作名单保持原样。

Codex App 会把附件说明和用户输入封装成 `Files mentioned by the user` 与 `My request` 文本。读取时按完整封装结构提取正文，图片由独立图片块显示，普通文件转换为附件标签。普通 Markdown 和不完整封装保留原文。

## 回复失败记录

一轮失败在消息流末尾显示“回复异常，本轮已结束”，原始错误放在可展开的详情里。下一次发送沿用原生用户消息顺序，失败记录保留在前一轮与新输入之间。输入框上方继续显示队列保存、加载、外部占用等当前操作错误；已归属到消息流的同一失败在该位置合并显示。

历史读取使用 CLI 原生结果：Pi 的 `stopReason: error` 与 `errorMessage`，Claude 的 `isApiErrorMessage`，Codex 官方 `thread/turns/list` 的 `failed` 和 `error.message`。这些记录归一化为 `Message.kind: assistant`、`isError: true`，桌面和手机再呈现为独立错误行。同一输入下后续助手请求或工具调用成功时清除已恢复的中途失败；下一条用户输入保留上一轮的最终失败。只在运行过程中出现且 CLI 没有保存的进程或传输错误，随所属输入暂存于窗口内存，按时间与同文输入次序定位，原生错误优先；应用重启后以 CLI 记录为准。

## 生成速度

生成速度是展示统计，由 Rust 的 `token_speed::Meter` 在每轮内采集。Claude 的输出块、Pi 的 `message_update`、Codex 的 `item/started` 提供生成边界；工具执行、确认等待、请求结束和失败重试关闭相应区间。请求结束上报的真实输出与该次区间配对，前端通过 `generationSpeed` 接收最近值、加权平均、峰值和可计时用量/时长。首包积压与未流出的输出保持独立，流式字符的相对份额用该次真实 usage 校准。单次片段不足 1 秒、校准后不足 5 token 或缺少可计时输出时，保留已有读数；当前轮尚无读数时显示“—”。

累计输出继续沿用 CLI 的全部真实 token，速度平均只覆盖有效校准片段。统计只在当前运行内存中，原生历史、计费和上下文用量使用各自原始来源。

## 运行中插入的消息

Tandem 的待发送队列由 `queue.rs` 管理。运行中发送先保存为本地草稿；当前轮正常结束、进程退出并释放原生任务后，才以新一轮交给 CLI。队列修改通过后端命令完成，附件和发送选项随条目保存。停止、出错和应用重启后，已有待发送消息保持暂停。任务空闲时发送的新消息直接开始新一轮：队列为空时如此；队列因停止、出错（如额度用完）或重启而暂停时，新消息排到队首并标记 `send_now`（只在内存）立即发出，原有消息继续暂停，等“继续发送”。新一轮收到 CLI 接收回执后清除旧的队列失败原因；本轮结束时，`error` 更新为本轮结果，成功则清空，再次失败则显示新原因。错误提示与队列暂停分别管理，成功续聊后原有消息继续等待用户恢复；清除结果随队列落盘并广播，重新打开应用时沿用。只有任务正在运行，或队列未暂停、马上要发下一条时，新消息才排到队尾。发送前不写原生会话文件，也不使用 CLI 自带的排队接口。

**插话**：任务在 Tandem 里运行时，消息也可以直接交给正在运行的这一轮，由 CLI 在当前工具结束后接上（`steer_turn`）。Claude 往运行中进程的 stream-json 输入再写一条用户消息，记录里存为 `queued_command` 附件；Codex 用 `turn/steer`（带 `expectedTurnId`）；Pi 用 RPC 的 `steer`。三者都在同一轮里处理，只产生一个结果（2026-11-09 用 haiku、Codex 临时线程和 `pi --no-session` 实测）。运行中按发送键排队，⌘↵（“⌘↵ 发送”时为 ⇧⌘↵）插话，三个 CLI 一致，对照参考和 Codex App；占位文字写明。插话的气泡标 `steered`，留在当前这一轮里，前面的工作过程照常显示；这一轮结束、读回原生记录后按记录分轮。运行期间重读的历史可能已经包含这一轮的开头和已接收插话。拼接时用实时首条提示的发送时间排除旧的同文轮次，再按「首条提示＋按顺序接收的插话」匹配历史输入序列（`historyBeforeLiveTurn`），从匹配的首条提示及同一时刻的配图行起移除历史中的同轮副本；实时内容保留一份。Pi 将插话落为普通 `user` 记录，Claude 和 Codex 读取后也共用用户消息形状，合并按本轮投递序列处理。结束时临时接入流式结果也使用同一边界，再由原生读取替换，避免交接期间重复。队列行的“插话”按钮（对照参考 `PendingQueuePanel.tsx` 的 steer，ArrowUp）：任务运行中时把这条交给当前这一轮（`steer_queued_turn`：先读出消息和附件并生成独立的图片预览，CLI 接收后才移出队列，拒收时原样保留；命令返回剩余队列与已接收消息，实时气泡采用返回的独立预览，队列临时图片回收后继续显示）；没有运行时移到队首并继续发送。行上不再有“移到队首”，排序靠拖动。

这一轮已结束或 CLI 拒收时（`NO_ACTIVE_TURN`、Codex 的 steer 错误、Pi 的 `success: false`、Codex 在回应前结束），消息改进待发送队列并提示，不会丢。Claude 以回显（`--replay-user-messages`）确认插话已被读取：结果先于回显到达时暂缓结束，关闭输入后等它把这条作为后续一轮跑完，或进程退出时再以暂缓的结果结束。

领取时把整条消息移到同一文件的 `inFlight` 字段并落盘；收到 CLI 接收回执后再删除。图片使用独立文件引用，发送前只读取当前条目的图片字节，同时生成 CLI 内容和发送气泡的独立预览。队列编辑可保留或移除已有附件，并添加新图片与文件；保留的附件 ID 必须属于当前条目。新增图片与修改后的元数据保存成功后，才释放新增附件的草稿引用并回收已移除的图片；保存失败保留原队列与新增附件，取消编辑只释放当次新增附件，普通输入草稿继续保留。只改文字与排序时沿用原图片文件。列表和 `inFlight` 都为空时删除 JSON，删除或确认接收后回收对应图片。旧内联格式在加载时迁移。接收前发生启动失败、拒收或退出时，条目回到队首并暂停。接收后的任务失败只暂停其余条目，已接收消息沿用 CLI 的会话记录。

| CLI | 接收回执 |
|---|---|
| Claude Code | `--replay-user-messages` 返回的主会话 `user` 消息，`isReplay: true`，`parent_tool_use_id` 为空。回显只用于确认，页面继续使用原用户消息 |
| Codex | `turn/start` 成功响应中的轮次 ID，或当前连接的 `turn/started` / `turn/completed` 通知 |
| Pi | ID 为 `prompt` 的成功 `response`；失败响应保留队首 |

`Started` 只用于界面与运行状态，可能早于子进程启动成功。是否放回队列按接收回执判断。接收确认属于后端内部信号，手机端事件协议保持原样。

应用重启后，残留 `inFlight` 回到队首，保留附件与发送选项，落盘为暂停状态，并提示“无法确定 CLI 是否已接收”。用户核对会话后决定删除或继续发送。普通待发送条目也保持重启暂停。这种仅因重启而暂停的队列在快照里标 `pausedAfterRestart`（不落盘），界面写“应用重启过，待发送的消息已暂停”，与停止或出错的“任务已停止，队列暂停”区分；任务开在别处时只显示写入者提示，不再叠一行暂停状态。队列清空后直接发送新消息时，`reserve` 清除旧的 `paused` 和 `error` 并落盘，使运行中再次入队的消息可在本轮成功后续发。

“仍要发送”只适用于当次立即发送尝试，`ignoreExternalWriter` 只作输入参数，队列文件保持省略。运行中入队、在已有消息后入队、显式恢复、重启和发送前失败后的重试都重新检查写入者；任务开在别处时暂停并显示原因。模型、强度与权限模式继续使用入队快照。

单个队列文件读取、解析或任务 ID 校验失败时，改名为带唯一后缀的 `.corrupt` 文件并保留内容；隔离失败时保留原路径。`queue-error` 带所属任务 ID，无法识别时为 `null` 并显示全局提示。其余队列继续加载，发送流程继续可用。页面先注册队列变化与错误监听，再请求初始列表。

用户在 CLI 运行时输入的内容，Claude 写成 `attachment` 行：`attachment.type` 是 `queued_command`，`humanTurn` 为真才是用户写的，内容在 `prompt`（字符串或内容块）。Tandem 插话写进 print 模式进程的消息不带 `humanTurn` 和 `origin`，`commandMode` 为 `prompt`，同样显示。任务通知（`origin.kind: task-notification`）和带 `isMeta` 的 peer 消息是程序排的，不显示。文字里的 `[Image #3]` 是终端的占位，读取时去掉。

队列和输入框共用一张卡片，列表直接起排，折叠入口作为列表末行。任务状态行放在整张卡片上方：运行时显示活动与耗时/Token；队列暂停时显示 Pause、“任务已停止，队列暂停”和右侧的“继续发送”。行操作默认隐藏，进入队列区时全体浅显，聚焦行继续可见，显示切换保留固定占位。拖动把手支持方向键、Home、End 排序。折叠只控制可见范围；“移到队首”只改变待发送顺序，当前轮沿用自己的执行周期。

## 编辑最后一条消息后重发

只开放 Claude Code。核对的版本：Claude Code 2.1.319、Codex 0.166.0、Pi 1.5.0。

| CLI | 原生能力 | 处理 |
|---|---|---|
| Claude Code | `--resume <id> --resume-session-at <助手消息 uuid>` 在打印模式下从该消息之后续写，同一个任务文件里留下新分支；`--resume-drops-turn <提示 uuid>` 声明要丢弃的是哪一轮，丢弃范围里有别的内容（吸收的排队消息、其他轮次）时 CLI 拒绝 | 支持 |
| Codex | `thread/rollback` 已在 0.156.0 移除，分页线程更早就不支持；只剩 `thread/fork`，会生成新任务 | 不显示入口 |
| Pi | RPC 只有 `fork`，从某条消息复制出新会话；原地移动分支的树导航只在 TUI 里 | 不显示入口 |

Codex 和 Pi 的 fork 会让任务换一个编号，原任务还在，这不是“编辑”，要做得先单独定交互。

规则：

- 只能编辑最后一条消息，且不能是第一条（它之前没有可以续接的助手消息），压缩之后的第一条也不行（截断会把压缩摘要一起丢掉）。带图片或文件附件的消息暂不开放，附件不会重发。
- 任务空闲、没有排队消息、没有待回答的请求、没被别处打开时才显示入口。
- 页面只传消息编号。后端从任务文件的当前分支找最后一条提示和它之前的助手消息，编号对不上就拒绝，不信任页面给的 uuid（`sessions::edit_anchor`）。编辑请求不进入队列，队列恢复时也会丢掉这个选项。
- 取消编辑不改历史。点“发送”后，轮次开始时页面才去掉被替换的那一轮，结束后按任务文件重读；CLI 拒绝截断时文件没有变化，重读后原样恢复。
- 只改对话，不恢复项目文件，编辑框里明确写出。Claude 的 `--rewind-files` 依赖文件检查点，打印模式下是否可靠没有验证，暂不使用。
- 读取时 `active_branch` 只取最后一条记录所在的分支，所以被替换的那一轮不会再显示。

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

已有任务的模型和推理强度按任务独立：打开时从 CLI 原生数据恢复，在任务里选择只影响当前任务，应用内切换任务后继续保留；新建页的选择按 Agent 保存为新任务默认值。Pi 沿当前分支读取 `model_change`、`thinking_level_change`，缺少模型变更时取助手记录的 provider/model；Codex 通过 `thread/read(includeTurns: false)` 读取 `model`、`reasoningEffort`，保持线程未加载；Claude 取当前分支最后一条真实助手记录的模型，强度缺少原生记录时继续由 CLI 决定。任务尚未发送的显式覆盖只保存在内存，发送后的选择继续由 CLI 原生任务保存；排队消息保持入队快照。原生模型不可用时续接保持省略模型和强度，由 CLI 恢复任务。原生模型 ID 与模型列表的 `resolvedModel` 匹配，默认别名和真实 ID 使用同一个模型入口。

三种 CLI 的默认模型来自各自的原生模型元数据。菜单在对应模型旁显示“默认”标签，当前选中项用行高亮表示。选择默认模型保存 `model: null`，后续继续跟随 CLI 的配置；选择其他模型只改变对应任务的发送选项；新建页的模型与强度写入 Tandem 新任务默认值。已解析的默认别名与真实模型合成一行；默认 ID 尚未解析时保留“跟随 CLI 配置”一行。CLI 没有报告默认模型时保持未知。

模型菜单显示读取状态和失败原因，失败时明确标识缓存，提供“刷新模型”。三种 Agent 在新任务的模型菜单中各有入口，空列表显示指引。中文强度名称区分 `xhigh`（超高）、`max`（最高）、`ultra`（极限）。只有一个可用档位时显示文字。

## 接入新 CLI 时

先确认它的官方接口和实际文件格式，写进本文件，再实现。读取和驱动都要有基于构造数据的测试。

## 附件

用户消息里的图片块原样读给页面显示。CLI 会另写一条 `isMeta` 的 `[Image: source: …]`，跟其他 `isMeta` 行一样隐藏。附件文件保存为提示词末尾的 `Attached file, readable with your tools even outside the workspace: 路径` 行，页面读回来显示成文件标签，生成标题时跳过。这句话要明说文件读得到：写成 `Attached file: 路径` 时，Codex 的低推理强度模型常常不去读，直接说读不到。

## 本机图片和本地链接

Codex App 的 `localImage` 与 `Files mentioned by the user` / `Image attachment: true` 封装共同还原为图片消息。仅后端原生历史解析器读取图片路径，限制 PNG、JPEG、GIF、WebP 扩展名、真实栅格文件头、普通文件与 5 MB 大小；页面只收到 data URL 或图片错误标记。Codex App 粘贴的图片放在系统临时目录，会被清理。文件缺失时，从同一 rollout 里 `<image name=… path="…">` 标记后面的 `input_image` 取回发给模型的那份 data URL（`codex/rollout_images.rs`），同样只接受四种栅格格式和大小上限。只有存在缺失图片时才扫描 rollout，每个路径的结果在本次运行内缓存；330 MB 的 rollout 实测扫描约 0.2 秒。两处都没有时保留图片身份，显示“图片已不在本机”，标题上下文也保留 `[image]` 标记。读取与图片编码在阻塞线程运行，页面没有任意路径读取接口。

本地 Markdown 链接通过任务 ID 取得原生工作目录，规范化相对路径、`~/` 和行号后调用系统默认程序；右键复制规范化后的完整路径。HTTP / HTTPS 继续走 `open_external`。行数统计只接受完整 unified diff 的 hunk 记录，片段或截断记录保留文件数。

设置页的 CLI 元数据读取规则见 [Agent 配置清单](agent-configuration-inventory.md)。

Claude 会话登记的 `entrypoint` 为 `cli`，或 `kind` 为 `interactive`（包装工具经 SDK 入口启动交互界面时）都算作终端里的任务。
