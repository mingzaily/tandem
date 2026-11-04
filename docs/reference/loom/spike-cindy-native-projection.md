# 验证：Cindy 界面能否直接用原生会话文件驱动

> 2026-10-29，代码层面验证（没有运行 Cindy）。对象：`reference/cindy@6b14c77f`。
> 问题：保留 Cindy 的界面、远程和插件，只把主进程中 `localDb.sessions`、`localDb.messages` 的数据来源换成「现读原生文件」（ccgui 的 `load_session_page` 做法），行不行？

## 结论

**可行。** 界面和远程都通过固定的 IPC 通道取数据，数据格式是「一个内容块一行」，和原生文件结构接近；会话对象的 22 个必填字段都能从原生数据得到。需要改的是主进程中约 30 个 `local-db:*` 通道的实现，以及两三处约定，没有发现必须保留平行层的硬依赖。

运行时还没有验证的部分（视觉效果、缓存层的边角行为）放到 loom 仓库搭好之后再跑。

## 1. 接缝

- 界面：`renderer/lib/makerTransport.ts` 的 `listMessagesFor`、`getSessionFor` 等函数，本机走 IPC `local-db:messages:list`、`local-db:sessions:*`，远程走 device-link 隧道转发**同名通道**（`device-link/src/allowlist.ts`、`main/device-link/dispatch.ts`）。
- 主进程：`main/localDb/ipc/messages.ts` 的 `readMessagesList(sessionId, opts)` 是消息读取的唯一入口，`historyView`（outline 和 hydrate）也走它。
- 所以在主进程替换这些处理函数的实现，**本机界面、远程控制端和手机端都不用改**。

## 2. 数据契约

`Message`（`renderer/lib/ccAgent.types.ts:550`）：`id`、`clientId`、`sessionId`、`role`、`content`、`toolUseId`、`agentMeta`、`agentKind`、`createdAt`，另外 `rowid` 可选（远程排序时用作同毫秒的决胜）。

| role | content | 原生来源 |
| --- | --- | --- |
| `user` | 文本（带图片时是结构体） | Claude user 文本块；Codex `UserMessage`；Pi `user` |
| `assistant` | 文本 | Claude `text` 块；Codex `AgentMessage`；Pi assistant `text` |
| `thinking` | `{kind:'thinking', text, durationMs, isRedacted, finishedAt}` | Claude `thinking`；Codex `Reasoning`；Pi `thinking` |
| `tool_use` | `{toolUseId, toolName, input}` | Claude `tool_use`；Codex 的各种 ThreadItem；Pi `toolCall` |
| `tool_result` | 文本 | Claude `tool_result`；Codex item 的输出；Pi `toolResult` |
| `error`、`agent_switch`、`ask_user`、`plan_review` | Cindy 自己的行 | 原生文件里没有：`agent_switch` 删掉；`error` 改为临时状态；`ask_user` 和 `plan_review` 由实时事件产生，结束后以原生记录为准 |

`Session`（`ccAgent.types.ts:340`）的 22 个必填字段，投影来源如下：

| 字段 | 来源 |
| --- | --- |
| `id` | 稳定 UI UUID；采用调用方预分配值，终端发现时从原生引用派生 |
| `nativeSessionRef` | `{engine, nativeId}`，官方读取与续接身份，绑定保存于 UI 元数据 |
| `sdkSessionId` | 原生 id |
| `title` | 原生标题（§13 D3） |
| `workingDir` | 原生 cwd |
| `agentKind` | 引擎 |
| `model`、`effort`、`permissionMode` | Claude：`assistant.message.model`、`permission-mode` 记录；Codex：`turn_context`；Pi：`model_change`、`thinking_level_change` |
| `totalTokenUsage`、`totalCostUsd`、`contextTokens`、`contextWindow` | 用量记录（Claude `cost-state` 和 usage；Codex `token_usage_record`；Pi usage） |
| `createdAt`、`updatedAt`、`userSendAt` | 时间戳 |
| `status` | 实时进程状态，加上外部写入者检测 |
| `pinnedAt` | `ui.sqlite` |
| `userId`、`workspaceKind`、`fastMode`、`clearedAt`、`extraDirs` | 常量或默认值（本地 owner、`project`、`false`、`null`、`[]`） |

## 3. Cindy 现成投影器能复用多少

Cindy 的「任务导入」里已经有原生转 `Message` 的代码，但只能部分复用：

| 引擎 | 文件 | 能复用的 | 问题 |
| --- | --- | --- | --- |
| Claude | `main/maker-host/claude-local-sessions.ts`（`parseClaudeCodeMessageLine`） | 逐行解析、`agentMeta`（uuid、transcriptParentUuid、parentUuid、model、usage）、合成消息过滤（`<command-name>` 等） | ① 按行线性读，**不按 `leafUuid` 走当前分支**；② **压缩摘要（`isCompactSummary`）会被当成用户消息**，`compact_boundary` 不显示；③ `isMeta` 没过滤；④ 图片在导入时会复制进 Cindy 的媒体库，现读时要改成按需引用；⑤ thinking 缺 `kind` 和 `finishedAt`；⑥ 用 `readline` 读文件，有 U+2028 断行的问题 |
| Codex | `main/maker-host/codex-local-sessions.ts`（5.7k 行） | 只能参考 `history_base` 的 fork 拼接 | ① **完全不支持 `.jsonl.zst`**（本机 1043/1070 个 rollout 是 zst）；② 基于 `response_item` 解析，工具名是原始名，和实时翻译器（`maker-core/agents/codex/translator.ts`：`exec`、`file_change`、`update_plan`、`web_search`、`view_image`）**不一致**，同一个改动在流式时和重新打开后显示不同；③ 导入时会复制 rollout，还会写入 Codex 自己的 sqlite（`thread_spawn_edges`），属于平行层 |
| Pi | 无 | — | 要新写；Pi 的 entry 格式和 RPC 事件里的消息是同一个 `AgentMessage`，可以复用 Pi 实时翻译器的映射 |

**原则**：历史投影和实时翻译必须共用同一套映射（Codex 基于 ThreadItem，Pi 基于 AgentMessage），否则流式时和重新打开后的显示不一致。

## 4. 实时和历史的合并（关键约定）

界面按 `clientId` 合并流式消息和历史消息（`renderer/lib/makerChatStore.ts`，例如 `messageIndexByClientId`）。Cindy 现在的 `clientId` 是它自己生成的 `persistId`，同时写进库里，所以两边对得上。改成现读原生之后，必须保证**同一条消息在两条路径上得到相同的 `clientId`**：

| 引擎 | 稳定 id | 实时路径能否拿到 |
| --- | --- | --- |
| Claude | `<record uuid>:<partIndex>` | 可以。Agent SDK 的完整消息带 `uuid`，和 jsonl 记录的 uuid 相同（Cindy 的 `noteAssistantTranscriptUuid` 已经在追踪）；流式增量阶段先用临时 id，收到完整消息后替换 |
| Codex | ThreadItem 的 `id` | 可以。实时的 `item/*` 通知和 rollout 里的 `item_completed` 是同一个 id |
| Pi | entry `id` | **待验证** RPC 事件里能否拿到 entry id；拿不到的话，在 `agent_settled` 后调用 `get_entries` 对齐 |

分页游标（`before`）是消息 id，稳定 id 天然满足。原生文件只追加写入；Codex 迁移改写文件时 item id 不变。

## 5. IPC 通道清点（约 30 个）

| 类别 | 通道 | loom 的实现 |
| --- | --- | --- |
| 读取 | `messages:list`、`around`、`around-client-id`、`view`、`view-intent`、`work-details`、`estimatedSessionValue`；`sessions:list`、`get`、`get-many`、`resolve-references` | 现读原生文件并投影，会话列表来自派生索引 |
| 推送事件 | `messages:created`、`deleted`；`sessions:created`、`patched` | 由 watcher 发现原生文件变化后发出 |
| 新建 | `sessions:create`、`messages:create` | Cindy 先建行再启动 agent。loom 需要一个「草稿会话」（只在内存里），拿到原生 id 后绑定；`messages:create` 只作为乐观显示，不落库 |
| 修改会话 | `sessions:update`、`patch-meta` | 标题走官方改名接口；置顶和隐藏写 `ui.sqlite`；模型和思考强度作为下一轮的运行参数，不当成事实存储 |
| UI 状态 | `touchUserSend`、`ack-interrupted`、`dismiss-pending-alerts`、`set-pinned-card-summaries`、`restore-if-archived`、`interrupted-pending`、`error-tail-pending` | 写 `ui.sqlite`，或者只放内存 |
| 改写消息 | `messages:updateContent`、`updateAgentMeta`、`dismiss-error`；删除消息；`/clear`（`clearedAt`）；rewind（`rewindAt` 软删除） | 原生文件里**没有对应的官方操作**，相关界面功能删除或改造：清空改成「新建会话」；rewind 改成官方 fork（Claude `--fork-session`、Codex `thread/fork`、Pi `fork`） |

## 6. 待运行验证（搭好 loom 仓库之后）

1. 用 Claude、Codex、Pi 各一个真实会话，打开后的显示和 Cindy 导入后的显示一致（压缩、并行工具、图片、子 agent）。
2. 流式进行到一半，然后结束：没有重复消息，也没有消息闪烁（`clientId` 约定）。
3. 远程控制端打开同一个会话，结果一致。
4. 在终端 `--resume` 追加一轮后，界面上自动出现，不用导入。
5. Cindy 界面里的缓存层（`persistCachedMessages`、`historyView` 的 revision 机制）：revision 改成基于原生文件签名之后，缓存是否正确失效。

## 7. 解决方案

已用代码确认：Node 24 的 `zlib` 自带 zstd 解压（`createZstdDecompress`），Electron 42 是同一代 Node；Cindy 的压缩分隔是一条本地行，`clientId` 为 `compact:<boundaryId>`、`systemCardType:'compact'`，按 id 去重（`makerChatStore.ts:7036`）；`claude` 二进制含 `--resume-session-at`，SDK 对应 `resumeSessionAt`，另有 `forkSession`、`rewindFiles`。

### 7.1 转换规则：历史和实时共用一套

每个引擎一个映射函数：输入规范化后的原生记录，输出 `Message` 行。读文件和实时事件都调用它。

- **Claude**：SDK 的完整消息 `{type, uuid, message}` 和 jsonl 记录同构。复用 `parseClaudeCodeMessageLine` 的块解析，并补上：按 `leafUuid` 重建主链（遇到 `compact_boundary` 时沿 `logicalParentUuid` 接回；把主链节点上的 `tool_result` 兄弟节点和同一 `message.id` 的拆分块收回；真分支只显示当前这条，并提示还有其他分支）；`compact_boundary` 输出为 `compact:<uuid>` 分隔行，`isCompactSummary` 折叠进分隔行；过滤 `isMeta`；thinking 补上 `kind` 和 `finishedAt`；只按 LF 切分，不用 `readline`。
- **Codex**：把 app-server 的 camelCase ThreadItem 和 rollout `item_completed` 的 PascalCase/snake_case 统一成一种规范形式；从 `maker-core/agents/codex/translator.ts` 抽出 item 到 `exec`、`file_change` 等的映射，两边共用。不用 `codex-local-sessions.ts`；`history_base` 的前缀拼接逻辑可以参考。zst 用 `zlib` 流式解压，文件签名不变就不重复解压。
- **Pi**：entry 和 RPC 事件里的消息都是同一个 `AgentMessage`，从 Pi 实时翻译器抽出映射共用。
- **图片**：不复制进媒体库。地址改为指向原生文件里的位置（引擎、会话、行号、块序号），主进程按需从文件里取出 base64 返回；可以加派生的磁盘缓存。

### 7.2 稳定 id

| 引擎 | clientId | 流式阶段 |
| --- | --- | --- |
| Claude | `<uuid>:<partIndex>` | 增量阶段用临时 id，收到带 uuid 的完整消息后替换 |
| Codex | ThreadItem `id` | 两边相同 |
| Pi | entry `id` | 拿不到时，在 `agent_settled` 后调用 `get_entries` 对齐并替换临时行 |
| 压缩 | `compact:<uuid>` | 沿用 Cindy 现成的去重逻辑 |

### 7.3 写操作

- **新建会话**：一开始就确定原生 id（Claude 和 Pi 用 `--session-id`，由 loom 预先生成；Codex 在新建时调用 `thread/start`）。GUI 会话 id 使用稳定 UUID，原生引用 `{engine, nativeId}` 单独绑定于 `native-ui.json`。调用方预分配 UUID 原样保留；终端发现的会话稳定派生 UUID。未发送的正文只放在内存里。用户于 B7 确认调整，见 `b7-remote-auth-plan.md` §8.6。
- **rewind**：Claude `resumeSessionAt`（在原文件分支）或 `forkSession`；Codex `thread/fork` 加 turn 锚点；Pi `fork` 或树导航。
- **清空**：改成新建会话。**删除和编辑消息、改 agentMeta**：删掉对应界面入口。**错误行**：改为临时状态，或写进 `ui.sqlite`。**agent_switch**：删掉。
- **置顶、提醒确认等**：写 `ui.sqlite`。**标题**：走官方改名接口。**模型和思考强度**：作为下一轮的运行参数。

### 7.4 新增的待实测项

- `resumeSessionAt` 在原文件里分支的实际效果；
- Pi 的 RPC 事件里能否拿到 entry id；
- Claude 主链重建规则：用并行工具、rewind、压缩三类 fixture，对照 `claude --resume` 的实际行为。

## 8. Cindy 和 ccgui 现有做法对照（取舍结论）

关键发现：`@anthropic-ai/claude-agent-sdk@0.3.292`（Cindy 锁定的版本）的 `sdk.d.ts` 提供一组**不需要启动进程**的官方会话函数：`getSessionMessages`（按 parentUuid 构建会话链；`includeSystemMessages` 返回系统记录，当前实测缺少 payload，见 §10.1）、`getSubagentMessages`、`listSessions`、`getSessionInfo`、`renameSession`（追加 `custom-title`）、`forkSession`、`tagSession`、`deleteSession`。

| 问题 | Cindy | ccgui | loom |
| --- | --- | --- | --- |
| Claude 当前分支 | 导入时线性读；fork 时用 `getSessionMessages` | 线性读 | SDK `getSessionMessages` |
| Claude 压缩 | 只在实时流里插分隔行 | 只计入用量 | `includeSystemMessages`，转成 `compact:<uuid>` 分隔行 |
| 合成消息过滤 | 过滤标签 | 处理 `isMeta`、`isSidechain` | 两边规则合并 |
| 图片 | 复制进媒体库 | 读取时内嵌 data URL（`ImageMode`） | 照 ccgui |
| Codex zst | 不支持 | 不支持（zstd 只用于 dsh） | 新写，Node 自带 `zlib` |
| Codex 记录类型 | `response_item` | `response_item` | 优先 `item_completed`，没有时退回 `response_item` |
| 实时和历史合并 | 按 clientId，依赖自己库里的 id | 一轮结束后整页重读，用 seq 做 id | 稳定原生 id，另加「一轮结束后整页重读」作保险 |
| Pi 分支 | `pi/session-tree.ts`（RPC `get_tree`） | 线性读 | 照 Cindy；没有进程时取最后一条 entry 作叶子 |
| 新建会话 id | 把自己的 id 作为 SDK `sessionId` 传入（预分配） | — | GUI 采用调用方 UUID，CLI 原生 id 单独绑定；Pi `--session-id` 使用原生 id |
| rewind 和 fork | SDK `forkSession` 加 `resumeSessionAt`，之后用 `fork-jsonl-repair` 改写文件 | — | 只用官方调用，不改写文件 |
| Claude 改名 | 存自己的库 | UI 覆盖 | SDK `renameSession`（不需要进程） |
| 删除或编辑消息、清空 | 只在自己的库里 | 无 | 删除这些功能 |

注意：Claude 读取改用 SDK 后，SDK 版本要和用户安装的 `claude` 格式匹配。设置页显示两者的版本；CLI 升级后用 fixture 跑回归。

## 9. 修正：三家都用官方读取接口，loom 不解析原生文件格式

§7、§8 里「Codex zst 和 item_completed 要新写」的结论作废。三家都有官方读取接口（Codex 用 `codex app-server generate-ts` 生成的类型核实；Pi 用已安装包的 `dist/core/session-manager.d.ts` 核实）：

| 引擎 | 会话内容 | 列表和元数据 | 改名 | 是否需要进程 |
| --- | --- | --- | --- | --- |
| Claude | Agent SDK `getSessionMessages`（`includeSystemMessages`）、`getSubagentMessages` | `listSessions`、`getSessionInfo` | `renameSession` | 不需要（库函数） |
| Codex | app-server `thread/items/list`（分页，可以按 turn 过滤；`ThreadItem` 和实时 `item/*` 同一类型；zst 和 `history_base` 由 Codex 内部处理） | `thread/list`（preview、cwd、model、forkedFromId、parentThreadId、archived） | `thread/name/set` | 需要 app-server（本来就常驻） |
| Pi | `SessionManager.open(path)` 加上 `getBranch()`、`getTree()`、`getLeafId()` | `SessionManager.listAll()`、`getSessionName()`、`getHeader()` | RPC `set_session_name` | 不需要（库函数）；建议从用户自己安装的 pi 包加载，保证版本一致 |

loom 只写一层薄适配：把官方返回的数据转成 Cindy 的 `Message` 行，转换规则复用 Cindy 的实时翻译器，所以历史和实时天然一致。格式变化由各家的读取实现负责。派生索引（跨引擎列表和全文搜索）也由这些接口喂数据，watcher 只负责发现变化、触发刷新。

待实测：
- Codex：`thread/items/list` 读取未加载的会话时，是否获取写锁；Codex App 正在持有这个会话时能否读取；能否读到外部追加的新内容（`thread_history_projection_state` 是否按字节偏移追平）。
- Pi：`SessionManager.open` 打开 v3 文件时是否完全只读（文档说旧版本加载时会自动迁移）。
- Claude：Agent SDK 和用户 CLI 的版本兼容区间。

## 10. C1 读取实测（2026-10-31）

§9 的三项已在 macOS arm64、Node 24.18.1 上实测，以下保留实现通道前的证据。聚合结果见 [`measurements/c1-native-read-2026-10-31.json`](measurements/c1-native-read-2026-10-31.json)，实现后的执行与重建见 §10.5。证据只包含版本、计数和检查结果。消息正文留在进程内存，Pi 临时副本和 Codex 测试目录在退出前删除。

从仓库根目录复跑：

```bash
node scripts/spikes/c1-native-session-read-probe.mjs
node scripts/spikes/c1-codex-append-probe.mjs
node scripts/spikes/c1-codex-extra-probe.mjs
```

三个脚本分别把聚合结果写到系统临时目录的 `loom-c1-native-read-probe.json`、`loom-c1-codex-append-probe.json`、`loom-c1-codex-extra-probe.json`。第一个脚本通过 PATH 找到用户 Pi 包的公开入口；Claude 使用仓库锁定的 SDK；Codex 使用 PATH 上的 CLI。第二个脚本用临时 `CODEX_HOME` 和 loopback 模拟 Responses 端点，通过官方 app-server 创建、追加测试会话；它只验证本地历史和锁，不验证线上模型或登录态。脚本没有编辑 CLI 配置的操作。

### 10.1 Claude：当前版本组合可读

- SDK `0.3.292`，用户 CLI `2.1.314`。
- `listSessions({ dir: loom仓库 })` 返回 1 个会话；`getSessionInfo` 返回相同原生 id。
- 默认读取 73 条消息；`includeSystemMessages: true` 另返回 4 条系统消息，共 77 条。返回的 UUID 均非空且唯一，`session_id` 一致。
- 读取前后原文件的 size、mtime、SHA-256 全部相同。

这证明 **SDK 0.3.292 与本机 CLI 2.1.314 的列表、元数据和普通历史读取兼容**。补充检查发现，4 条系统记录只有 type、UUID、session_id、时间和父节点标识，`message` 为 undefined，SDK 未返回 subtype 或压缩摘要。因此无法通过该接口区分压缩边界和其他系统记录；loom 显示「此条原生系统记录需在 Claude Code 中查看」，保留标识和顺序，不读取私有格式猜测类型。单个版本组合不能证明兼容区间，也不能代表未来 CLI 升级后的行为。后续升级需复跑；本次没有下载其他版本 CLI。

### 10.2 Pi：v3 的 open/getBranch 可只读运行

- 从用户安装的 `@earendil-works/pi-coding-agent@1.4.0` 公开入口加载 `SessionManager`。
- `listAll()` 返回 15 个会话，loom 仓库目录下为 0 个。对每个源文件生成临时副本，权限设为 `0400`，再调用 `open()`、`getHeader()` 和 `getBranch()`。
- 15 个副本均成功打开，官方 `getHeader()` 报告版本均为 3，分支条目合计 5,682 个。15 个副本和 15 个原文件的 size、mtime、SHA-256 均保持相同。
- 已安装包的 `_loadEntries()` 在版本迁移后调用 `_rewriteFile()`；`open()` 也会初始化空文件。因此，**实测只读结论适用于已有内容的 v3 样本**，不能把 `open()` 当成所有版本的只读接口。
- 补充中断写入样本：通过官方 `SessionManager` 在临时目录创建 v3 会话，再去掉最后的换行。`open()` 在 `0400` 权限下报 `EACCES`，副本保持原样；改为可写后再次打开，文件增加 1 字节。已安装包的 `loadEntriesFromFile()` 会在末行缺少换行时追加 `\n`，这个行为也适用于 v3。

C1 内容读取应统一让官方 API 打开临时副本，允许官方迁移或末行修复在副本上完成，读完删除；原文件保持只读。`listAll()` 的返回值含 `allMessagesText`；索引写入必须逐字段选取元数据，不能展开保存整个 `SessionInfo`。

### 10.3 Codex：现读不加载线程，外部追加可见

使用用户安装的 `codex-cli 0.166.0`。协议参数和返回类型由该版本的 `codex app-server generate-ts --experimental` 核对。

| 检查 | 实际结果 |
| --- | --- |
| `thread/list` 按 loom cwd 查询 | 非归档 3 个，归档 0 个；两组分别查询并处理分页 |
| 未加载且没有写入者的会话 | `thread/items/list` 分 23 页返回 2,224 个 item，原生 item id 唯一；读取前后均未进入读取方 `thread/loaded/list`，读取后无写锁，原文件签名相同 |
| App 持锁的会话 | 最新复跑分 11 页返回 1,055 个 item，原生 item id 唯一；读取前后读取方均未加载线程，外部锁仍由原持有者持有，原文件签名相同 |
| 锁所属进程 | `lsof` 与 `ps` 确认为 `ChatGPT.app` 内置的 Codex 进程；锁探测使用 Python `fcntl.flock(LOCK_EX \| LOCK_NB)`，只读打开已有锁文件 |
| 外部追加追平 | 临时目录里，一个 app-server 通过官方 turn API 追加，另一个只调用 items/list；两次读取从 1 个 item 变为 2 个，新增用户消息可见，已有 item id 保持相同，读取方始终没有加载线程 |
| 归档读取 | 全局归档列表第一页返回 100 条且有下一页；抽取其中一个会话读到 12 个 item，原文件签名相同 |

外部追加实验验证的是接口返回结果，未读取 Codex 私有投影表，不能据此宣称内部按字节偏移实现。全局按创建时间升序、启用默认 scan-and-repair 的一次 `thread/list` 在 30 秒超时；同样查询加官方 `useStateDbOnly: true` 成功。这个选项跳过 metadata 修复，不能直接作为 C1 发现新会话的替代。当前抽样未找到 API 返回路径以 `.zst` 结尾的会话，压缩样本读取仍待补验，loom 继续交给官方接口处理格式。

**续接的实际边界**：临时写入者调用 `thread/unsubscribe` 返回 `unsubscribed`，3 秒后仍在 `thread/loaded/list`，flock 仍被持有；另一进程 `thread/resume` 返回 `-32600`、`already has an active writer`。写入者进程退出后，锁释放，另一进程 resume 成功。§4.2 的「unsubscribe 即释放线程」假设在这次实验中不成立；续接实现必须管理写入进程的释放，读取接口可以使用独立的常驻只读 app-server。

补充空会话实验：`thread/start` 分配 id 后、首轮发送前，原生 rollout 尚未生成；即使同一 app-server 调用 `thread/resume`，仍返回 `no rollout found`。loom 新建时保留该官方线程和进程，首次发送直接使用已创建的线程；有原生历史的会话按原 id resume，失败直接报告。单元验证同时确认写入者退出、独立读取者保持存活。新线程显式选择官方 `historyMode: paginated`。

### 10.4 实现前的确认边界

现有 `sessions` 表覆盖引擎、原生 id、cwd、标题和活动时间，缺少原生文件路径、size、mtime。`skill_usage_sources` 有文件签名列，但还受 Skill 分析事务、按分析版本/时间删除规则和 `skill_usage_exposures` 外键约束；把它拼接成会话索引会改变该表的职责和清理契约。

建议新增职责独立的元数据派生表；最小 SQL 和复用评估已写入 [`slimming-plan.md` 的 C1 实测与索引方案](slimming-plan.md#c1-实测与索引方案2026-10-31已确认)。曾按本次任务的「索引需要新表时先停下来」要求等待确认，用户随后明确确认新增独立派生表，继续实现。历史 migration 保持原样。

### 10.5 C1 执行与重建实测

元数据证据见 [`measurements/c1-native-runtime-2026-10-31.json`](measurements/c1-native-runtime-2026-10-31.json)。复跑命令：

```bash
node --import tsx --import ./scripts/spikes/c1-node-assets.mjs scripts/spikes/c1-native-pi-roundtrip.mts /用户安装的/pi
node --import tsx scripts/spikes/c1-native-index-rebuild.mts /用户安装的/pi
```

第一个脚本使用生产 `PiAgent`，以 `<engine>:<nativeId>` 创建会话，用户 CLI 写入自己的 `~/.pi/agent/sessions`。官方 `SessionManager.listAll()` 能发现；关闭 loom 适配器运行实例后，终端启动用户 Pi、用 `--session` 打开相同文件并发送第二轮。两次回复均匹配本次标记，官方分支读取返回 2 个用户轮次，原生 id 相同，文件随第二轮增长。两个测试会话保留在用户原生目录，供后续界面验收；脚本只清理临时桥接目录。该实验验证生产适配器与终端往返，完整 Desktop 按钮操作另行记录。

**实测发现的配置副作用**：旧适配器启动时发送 `set_auto_compaction { enabled: true }`；Pi 1.4.0 的此 RPC 调用 `settingsManager.setCompactionEnabled()`，会写全局配置。首次实验让 `~/.pi/agent/settings.json` 新增 `compaction.enabled=true`，43 字节。已移除该启动调用，继承用户自己的压缩选择；同时移除“拒绝强制开启即启动失败”的旧测试，新增“启动不发送写配置 RPC”断言。修正后的真实往返没有引入其他配置变化。Claude settings、Codex config、Pi models 的 SHA-256 与测试前一致。

2026-11-01 用户明确授权精确恢复测试前原文。核对当前内容后，仅移除这次新增的 43 字节，恢复为 1,129 字节；恢复后的 SHA-256 为 `bbbb34d5fb589604015c46dcae5efe1c429389d10e15614e3a09e7f48ea76753`，与测试前完全一致。随后完整 Desktop 三轮往返与重建完成后，再次核对 Claude settings、Codex config、Pi settings 和 Pi models，四份文件均与测试前哈希一致。

第二个脚本使用生产索引、三家官方 lister 和独立临时 profile。loom 项目实际取得 Claude 1、Codex 15、Pi 2，共 18 个会话（Codex 包含显式请求的各官方 source kind）。删除整个临时 profile，重新选择相同 cwd 后扫描，18 个原生 id 全部恢复；索引仅有方案中的 9 列，原文件 size/mtime 全部不变。源签名稳定的三家在连续扫描时均跳过了官方列表重读。这个实验覆盖索引和官方 API，Mac 锁屏期间无法替代完整 Desktop 的删除 profile 后重启验收。

### 10.6 完整 Desktop 验收闭环（2026-11-01）

Mac 解锁后，以 `pnpm dev:desktop --isolated=loom-c1-native` 启动独立 profile。聚合证据见 [`measurements/c1-native-completion-2026-11-01.json`](measurements/c1-native-completion-2026-11-01.json)。以下结果来自真实窗口操作、用户安装的 Pi CLI 和生产官方读取器。

1. 在 loom 项目内通过 GUI 新建 Pi 会话，原生 id 为 `baad8c33-05f6-44b0-ba83-9da2388fbca4`。首轮回复匹配验收标记；会话位于用户自己的 `~/.pi/agent/sessions`，官方 `SessionManager.listAll()` 能找到。
2. 终端运行用户 Pi，以 `--session` 续接同一文件并追加第二轮；同一个原生 id、预期回复和文件增长均验证通过。回到 loom 点击“刷新原生会话”，第二轮输入和回复出现在原会话。
3. GUI 第三轮询问最近记住的口令，模型回复终端第二轮设置的值。轮次收尾后关闭空闲的三家 CLI 执行实例，下一轮从相同原生 id 重新加载，确保终端追加进入执行上下文。
4. 优雅退出独立测试实例，将其完整数据目录移到 `/tmp` 保留恢复能力，使应用数据路径为空。重启后通过系统文件夹选择器重新添加 loom 仓库，22/22 个原生 id 全部恢复：Claude 1、Codex 18、Pi 3。三家原生历史均可打开，Pi 三轮历史完整读回；恢复后的索引仍为 9 列，25 张 SQL 会话关联表中的原生记录合计 0 行。会话数量相较 §10.5 增长来自新增实测和终端会话。

GUI 首次发送暴露了旧轮次租约和排队输入快照仍写 SQL 的接线缺陷，外键引用的原生 `sessions` 行按设计不存在。现已让原生轮次锁、通知信号、队列和投递 id 仅驻留内存；手机待发送队列及历史交接也跳过原生正文的磁盘写入。原生投影省略持久化重试标记，重启后只从 CLI 恢复已接受的历史。SQL/SSH 会话保留原有持久化语义，未新增消息表或占位会话行。

终端续接复跑命令（先在 GUI 创建专用 Pi 测试会话，替换参数；脚本会追加一轮）：

```bash
node --import tsx scripts/spikes/c1-native-gui-terminal.mts /用户安装的/pi <native-id> <native-session-path>
```

原 15 个 UI 失败已完成根因修复，保留原断言与时限：4 个视频场景由隐藏宿主拒绝 fullscreen、macOS 原生窗口切换无法完成引起，宿主仅为固定测试 origin 允许真实 DOM fullscreen；3 个邮件场景由 ResizeObserver 回调同步收缩 iframe 引起，尺寸重算移到下一帧并在卸载/替换内容时取消；其余 8 个由长批次复用同一 WebContents 后导航停止响应及连带窗口关闭引起，每个场景现在拥有独立渲染生命周期，并用 `window.name` 跨导航残留断言验证隔离。完整矩阵 152/152 通过，宿主自测 5/5 通过；原生 OS Space 动画仍属于完整桌面场景的范围。

最终 desktop 全量 2,210 文件 / 32,853 用例通过，5 文件 / 32 用例跳过，0 失败；mobile 全量 691 文件 / 9,723 用例通过，0 失败；两端 typecheck 均 0 错误。最终空 profile 启动、添加项目和打开三家历史期间，日志 0 条 `[ERROR]`。前一实例优雅退出时，旧 `CodexAgent.dispose()` 输出过两条 error 级正常清理诊断；这是退出日志级别问题，留后续清理，未计作启动通过的证据。§10.1 的 Claude 系统记录 payload 缺失与 §10.3 的 Codex 压缩样本待补验继续保留。


### 10.7 原生中断记录与 Cindy 消息间距（2026-11-02）

实际使用 Claude Agent SDK `getSessionMessages()` 读取截图对应会话，发现 1 条独立中断记录，内容形状为单个 text block。Cindy 自己运行的停止路径调用 SDK interrupt、结束流式状态并保留输出，没有额外的中断提示行；旧外部历史导入路径将该记录视作普通 user 文本。

按用户确认的 Cindy 样式，loom 的官方历史转换消费独立的 `[Request interrupted by user]` 及工具中断变体，保留已生成输出和现有工作摘要，不新增用户气泡或系统提示行。被引用的标记、混有图片等其它块的用户输入保持原样。整个转换只发生在读取投影中，原生文件和剩余消息锚点保持原样；没有新表、消息副本、IPC、配置或 CLI 文件写入。四份 CLI 配置 SHA-256 在本次检查前后相同。

间距只读对照：`WorkGroupBlock.tsx`、`ThinkingCard.tsx` 和 `chatChrome.ts` 与 reference/cindy 相同；两边 `MessageStream` 的正常任务消息列均使用 `gap-3.5`。真实 MessageStream UI 场景测得工作摘要容器到正文容器间隔 **14 CSS px**，沿用 Cindy 的行高、操作栏和间距，不增加补偿性 margin。截图与断言位于 `scripts/fixtures/native-history-stop/`。

业务逻辑审查覆盖独立标记识别、普通输入保留、部分回复与历史锚点、以及 P0/P1/P2。代码设计审查复用官方读取和现有 Cindy 消息组件，根因修正在历史分类处完成，不增加新的显示样式或会话层。最终 `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck` 和 `pnpm --filter @cindy/maker-core run build`（tsc --noEmit）均 0 错误。`vitest run` 定向检查：maker-core 的 native-history 为 1 文件 / 10 用例；desktop 的原生 backend、workGroupDurationAnchor、workGroupProjectionParity 为 3 文件 / 54 用例，合计 **4 文件 / 64 用例通过，0 失败**。`pnpm ui:check --changed --theme all` 为 **170/170 通过**；原生停止场景额外运行中英文 × 深浅色，**4/4 通过**，并已查看概览和实际截图。最终官方 SDK 现读后，1 条中断记录产生 0 个显示行、0 个额外提示行，其余用户内容保留。本次没有重跑两端全量单测，不复用 B7 的全量数字。

本修复独立提交，保留工作区内并行 B8 改动；reference/ 与历史 migration 保持原样，未 push。
