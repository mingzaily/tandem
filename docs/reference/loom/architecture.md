# loom 架构设计（第一阶段）

> 状态：草案 v2（2026-10-29）。v2 变化：以 Cindy 为底子往下删（§1.1）；三家会话都通过官方读取接口读取，loom 不解析原生文件格式（§2.4）；建仓库时导入快照、不保留 git 历史（§12）。验证报告见 `docs/loom/spike-cindy-native-projection.md`。
> 依据：本机实测（claude 2.1.312、codex-cli 0.163.0、pi 1.4.0）+ `reference/cindy@6b14c77f` + `reference/ccgui@810e50d`。
> 本文的所有格式结论都来自本机真实文件，只提取结构，没有摘录对话内容。

## 0. 结论先行

0. **随时可以不用 loom，不需要任何迁移。** 会话记录由各 CLI 自己写、自己管；loom 只读（而且只通过官方接口读），写入也只走官方操作；loom 自己的数据只有可以删除的派生索引和 UI 元数据；对 CLI 的配置零改动。卸载 loom、删掉它的数据目录，CLI 照常使用，会话一个不少（P0，验收用例 T19）。
1. **三家原生格式都能做到无平行层。** 三家都是追加写入的 JSONL，消息、工具调用、压缩、子 agent、标题、cwd 都能从原生文件取到。没有一个功能必须让 loom 保存对话事实。
2. **事实源比想象中更「活」。** Codex 会改写并压缩旧 rollout（`legacy_to_paginated_v1` 迁移，本机 1043 个 `.jsonl.zst`）。Claude 2.1.312 新增了十多种记录类型。Pi 加载时会把旧版本文件自动迁移到 v3。所以解析器必须宽容，索引必须随时可以重建。这正好就是「派生索引」的定义。
3. **并发写有可靠的检测手段。** Claude 有 `~/.claude/sessions/<pid>.json`，Codex 有 `~/.codex/thread-writer-locks/<threadId>.lock`（flock）。Pi 没有，只能靠启发式判断。
4. **执行层三家都有官方的机器接口**：Claude 用 Agent SDK（底层是 `claude` 的 stream-json 控制协议），Codex 用 `codex app-server`（JSON-RPC，类型可以用 `codex app-server generate-ts` 按已安装版本生成），Pi 用 `pi --mode rpc`（JSONL）。
5. **跨引擎多 agent 协作第一期就做。** 任何会话，或者用户本人，都可以当 Lead，通过 `loom_team` 派活给其他引擎；团队关系从 Lead 的原生转录派生，不另外存储（§7）。
6. **magpie 类能力不做。** Cindy 里约 5 万行的模型网关和协议桥（见 §9.3）和原则 3 冲突，全部丢弃。loom 和 magpie 正交：用户用 magpie 改写各 CLI 的配置，loom 启动的官方 CLI 会自然继承。

---

## 1. 原则复述（实现约束）

| # | 原则 | 落到实现上 |
| --- | --- | --- |
| P0 | 随时可以不用 loom | 不需要迁移、不留痕迹：会话在各 CLI 里，loom 的数据目录可以整个删掉；MCP 和扩展只通过启动参数注入，不写用户的 CLI 配置。任何功能如果会让用户「离开 loom 时丢东西」，就不做。 |
| P1 | 原生会话是唯一事实源 | loom 永远不写原生会话文件，也不修补（Cindy 的 `fork-jsonl-repair` 不搬）。所有写入都通过官方 CLI 或 API 完成。 |
| P2 | 本地只存派生索引和 UI 元数据 | 分成两个 SQLite 文件：`index.sqlite`（删了重扫）和 `ui.sqlite`（删了不影响会话）。不变量写成 CI 测试。 |
| P3 | 执行只走官方 CLI 和用户登录态 | 只透传环境变量，不注入凭据，不起代理，不碰 `auth.json`。 |
| P4 | 双向无缝切换 | 监听原生目录，检测外部写入者；不在同一会话上同时跑两个写入者。 |
| P5 | 会话绑定一个引擎 | 跨引擎只做「新建会话」，不搬上下文。多 agent 协作时，Worker 只拿到任务说明，代码自己从工作区读（§7）。 |
| P6 | 引擎可插拔 | `EngineAdapter` 接口加能力声明；能走 ACP 的引擎用一个通用适配器。 |

### 1.1 实现基线：以 Cindy 为底子往下删

loom 不从零写界面，而是**以 Cindy 为底子，删掉不要的部分，再把平行会话层换掉**。这样 Cindy 的界面、样式、设置、插件框架、远程（device-link、自建中转、手机端）都能直接复用。

- **接缝**：Cindy 的界面和远程都通过同一批 IPC 通道（`local-db:sessions:*`、`local-db:messages:*`、`maker:*`）取数据，入口在 `renderer/lib/makerTransport.ts`；远程隧道转发的也是这些通道。loom 只在主进程里换掉这些通道的实现：数据从 Cindy 的 SQLite 换成官方读取接口加派生索引。界面、远程、插件都不用改。
- **已经用代码验证可行**：见 `docs/loom/spike-cindy-native-projection.md`（数据契约、约 30 个 IPC 通道的清点、实时和历史合并的 `clientId` 约定、写操作的处理）。
- **保留、替换、删除**：见 §9.1。
- 本文 §3 到 §5 中「core 自带 wire 协议」「TranscriptItem」等设计，在实现上对应为 Cindy 的 IPC 契约和 `Message` 行；原则和语义不变。

---

## 2. 三引擎原生会话格式对照（本机实测）

### 2.1 总表

| 维度 | Claude Code 2.1.312 | Codex 0.163.0 | Pi 1.4.0 |
| --- | --- | --- | --- |
| 根目录 | `$CLAUDE_CONFIG_DIR/projects` 或 `~/.claude/projects` | `$CODEX_HOME/sessions` 和 `archived_sessions` | `$PI_CODING_AGENT_DIR/sessions`（默认 `~/.pi/agent/sessions`）；可被 `--session-dir`、`PI_CODING_AGENT_SESSION_DIR`、settings 里的 `sessionDir` 覆盖 |
| 目录键 | `cwd.replace(/[^a-zA-Z0-9]/g,'-')`；超过 200 字符会被截断并追加 CLI 私有 hash，无法复算 | 按日期分目录：`YYYY/MM/DD/` | `--<cwd 去掉开头的 /，把 / \ : 替换成 ->--` |
| 文件名 | `<sessionId>.jsonl` | `rollout-<ISO 时间>-<threadId>.jsonl`，旧文件为 `.jsonl.zst` | `<ISO 时间>_<uuid>.jsonl`；本机还有一批 `<uuid>.jsonl` **符号链接**，指向仓库内的 `.session-hub/pi-sessions/` |
| 第一行 | 无固定头部 | `session_meta`（id、cwd、cli_version、source、git、fork 和子 agent 字段） | `{"type":"session","version":3,"id","cwd","timestamp","parentSession?"}`；本机有 1 个文件缺少头部，第一行是 `model_change`，必须容错 |
| 记录结构 | 每行带 `type`；消息行有 `uuid`、`parentUuid`、`sessionId`、`cwd`、`gitBranch`、`version`、`timestamp` | 每行是 `{timestamp,type,payload}` | 每行有 `type`、`id`（8 位 hex）、`parentId`、`timestamp` |
| 消息 | `user` 和 `assistant` 记录里的 `message` 是 Anthropic Messages 格式（content blocks） | 同一事实有两套表示：`response_item`（模型层原始数据）和 `event_msg/item_completed`（规范化的 ThreadItem）。**解析以 ThreadItem 为准** | `message` 记录里的 `message.role` 取值为 `system`、`user`、`assistant`、`toolResult` |
| 思考 | assistant 的 `thinking` block | `Reasoning` item（`summary_text`、`raw_content`）；`response_item/reasoning` 是加密的 | assistant 的 `thinking` block |
| 工具调用 | assistant 的 `tool_use` block，加上 user 的 `tool_result` block；结构化结果在 `toolUseResult` 字段；大输出落盘到 `<sessionId>/tool-results/*.txt` | ThreadItem：`CommandExecution`、`FileChange`（自带 changes）、`McpToolCall`、`ImageView`、`Extension`、`FunctionCallOutput` | assistant 的 `toolCall` block，加上 `toolResult` 消息（`toolCallId`、`toolName`、`isError`、`details`） |
| 一个回复拆多行 | 一个 `message.id` 会拆成 1 到 5 条记录（每个 block 一条）。**并行工具调用会让同一父节点有两个子节点**（assistant 和 tool_result），这不是分叉 | 无此情况 | 无此情况 |
| 分支（同一文件内） | `parentUuid` 构成树；当前叶子由最后一条 `last-prompt.leafUuid` 决定（可能带 `rewound`）。本机 4 个文件都没有 rewind 分支，全部分叉点都是并行工具调用 | 无，线性 | `id`/`parentId` 构成树，`/tree` 在文件内分支，`branch_summary` 记录被放弃的分支。本机暂无分支 |
| 分叉（新文件） | `--fork-session` 生成新 sessionId 的新文件 | 新 rollout，`session_meta.forked_from_id`，加上 `history_base {thread_id, end_ordinal_exclusive, end_byte_offset}`。**fork 文件不复制父历史，要拼接父 rollout 的前缀** | `/fork`、`/clone` 生成新文件，头部带 `parentSession`（父文件路径） |
| 压缩 | `system/compact_boundary`（`parentUuid:null`，形成新根；`logicalParentUuid` 接回旧链；`compactMetadata` 里有 trigger、pre/postTokens、preservedSegment），后面跟一条 `isCompactSummary:true` 的 user 记录 | `compacted` 记录（`replacement_history`、`window_id`、`window_number`），加上 `ContextCompaction` item | `compaction` 记录（`summary`、`firstKeptEntryId`、`tokensBefore`）；另有 `context_edit` 只影响后续上下文 |
| 子 agent | **单独的文件**：`<project>/<sessionId>/subagents/agent-<agentId>.jsonl`，加上 `.meta.json`（从 CLI 二进制确认；本机暂无样本）；记录带 `isSidechain` | **单独的 rollout**：`session_meta.source = {subagent:{thread_spawn:{parent_thread_id}}}` 或 `{subagent:{other:"guardian"}}`（自动审查）；父会话里有 `SubAgentActivity` 和 `CollabAgentToolCall` items；Codex 自己的 `state_5.sqlite.thread_spawn_edges` 有父子边 | 由 pi-subagents 扩展写入：`<父会话文件名去掉扩展名>/<runId>/run-0/session.jsonl`，格式就是普通 Pi 会话 |
| 标题 | 优先级：`custom-title.customTitle`（`/rename`、`-n`）> `ai-title.aiTitle`（会反复追加，取最后一条）> 第一条用户消息；另有 `agent-name` | `session_index.jsonl` 里每个 id 最后一条 `thread_name`；`state_5.sqlite.threads.title/name`（Codex 私有库，只读兜底）；第一条 UserMessage | `session_info.name`（`/name`），取最后一条；否则取第一条用户消息 |
| 工作目录 | 每条消息的 `cwd`（会变化，本机一个会话里出现过 3 个不同值）；`relocated.relocatedCwd`；**目录名不可逆，要以记录里的 cwd 为准** | `session_meta.cwd`，以及每轮 `turn_context.cwd` 和 `workspace_roots` | 头部的 `cwd` |
| 模型和用量 | `assistant.message.model` 和 `usage`；`cost-state` 记录（totalCostUSD、modelUsage） | `turn_context.model`；`token_usage_record` 和 `event_msg/token_count`（含 rate_limits） | assistant 的 `model`、`provider`、`usage`；`model_change`、`thinking_level_change`、`usage` 记录 |
| 轮次边界 | `system/turn_duration`；`queue-operation` 记录排队 | `task_started`、`task_complete`、`turn_aborted`（带 `turn_id`） | 无显式记录（RPC 有 `agent_end` 和 `agent_settled` 事件） |
| 噪声记录 | `api-request`、`api-request-blob`、`api-request-shape`、`atis-latch`、`mode`、`permission-mode`、`tools-used`、`file-history-*`、`attachment`、`isMeta` 消息 | `world_state`、`thread_settings_applied`、`token_count`、developer 角色消息 | `custom`（扩展状态，不进上下文）、`system` 消息（提示词补丁） |
| 正在运行的标记 | `~/.claude/sessions/<pid>.json`：sessionId、pid、procStart、status、cwd、messagingSocketPath | `~/.codex/thread-writer-locks/<threadId>.lock`（空文件，靠 flock 持有；本机由 ChatGPT.app 内置的 codex 持有） | 无 |
| 上游私有索引 | `history.jsonl`（输入历史） | `state_5.sqlite`（threads 表 1314 行）、`thread_history_1.sqlite`（rollout 投影，记录字节偏移）、`session_index.jsonl` | `pi-web-session-index.json`、`*.meta.json`（pi-web 写的旁路文件；本机有 47 个找不到对应 jsonl） |

### 2.2 各引擎的解析要点

**Claude Code**
- 重建当前分支：取最后一条 `last-prompt.leafUuid`，沿 `parentUuid` 往回走；遇到 `compact_boundary`（`parentUuid` 为 null），通过 `logicalParentUuid` 接回压缩前的链。UI 显示压缩分隔条，旧消息折叠。
- 同一 `message.id` 的多条 assistant 记录合并成一个回复；`tool_use.id` 和 `tool_result.tool_use_id` 配对。
- 文件里没有 `leafUuid`（老版本或中断）时，取最后写入的消息作叶子。
- 发现会话：扫描 `projects/*/*.jsonl` 和 `projects/*/*/subagents/*.jsonl`，**不要用 cwd 去计算目录名**（ccgui 和 Cindy 都踩过超长路径的坑）。

**Codex**
- 用 `event_msg/item_completed` 的 ThreadItem 渲染，它和 app-server 的 `item/*` 通知是同一模型，历史和实时可以共用渲染器。`response_item` 只在 ThreadItem 缺失时兜底。
- 本机最老的 2025 年文件也已经被迁移成新格式，所以**不需要实现旧版 Codex 格式解析器**；但遇到未知格式时必须降级成「无法解析，请用 Codex 打开」，不能崩溃。
- `.jsonl.zst` 要流式解压（`zstd` WASM 或原生绑定），文件签名不变时不重复解压。
- fork：读到 `history_base` 时，把父 rollout 的前 `end_byte_offset` 字节作为前缀。
- 子 agent 和 guardian 会话默认从主列表隐藏，挂在父会话下面。

**Pi**
- v3 树结构：当前叶子是文件中最后一个 entry（Pi 的语义：最后追加的就是当前位置）。用 `buildContextEntries` 的逻辑处理 `compaction` 和 `context_edit`；UI 显示原始条目，`context_edit` 只标记「已从上下文移除」。
- 跟随符号链接，按 realpath 去重；同时监听链接目标所在的目录。
- 忽略 `*.meta.json` 和 `*.touches.json`。它们是 pi-web 的旁路文件，不是 Pi 原生数据。

### 2.3 统一的转录模型（解析输出）

三家都规范化成同一套 `TranscriptItem`，**和实时事件流里的 item 是同一个类型**（见 §4）。这样「历史回放」和「流式渲染」用同一套组件，一轮结束后从文件重新读取就能无缝替换。

```ts
type TranscriptItem =
  | { kind: 'user'; id; ts; text; images?: Ref[] }
  | { kind: 'assistant'; id; ts; text; model? }
  | { kind: 'reasoning'; id; ts; text; redacted?: boolean }
  | { kind: 'tool'; id; ts; tool: ToolKind; name; input; status: 'running'|'ok'|'error'|'denied';
      output?: ToolOutput; diff?: FileDiff[]; childSession?: SessionRef }
  | { kind: 'compaction'; id; ts; trigger: 'auto'|'manual'; tokensBefore?; tokensAfter?; summary? }
  | { kind: 'notice'; id; ts; level; text }            // 模型切换、中断、错误、命令等
  | { kind: 'unknown'; id; ts; raw: unknown };           // 未识别的记录，不丢，可展开查看
type ToolKind = 'shell' | 'edit' | 'read' | 'search' | 'web' | 'mcp' | 'subagent' | 'plan' | 'other';
```

每个 item 都带 `native: { file, line | byteOffset, uuid/id }` 作为回溯锚点，供「在原始文件中定位」和调试使用。

### 2.4 读取方式：官方内容接口与只读状态边界

§2.1 到 §2.3 是格式调研的记录，用来理解各家的语义。**正文、分支和工具语义由三家的官方读取接口负责**：

| 引擎 | 会话内容 | 列表和元数据 | 改名 | 是否需要进程 |
| --- | --- | --- | --- | --- |
| Claude | Agent SDK `getSessionMessages`（`includeSystemMessages`）、`getSubagentMessages` | `listSessions`、`getSessionInfo` | `renameSession` | 不需要 |
| Codex | app-server `thread/items/list`（`ThreadItem` 和实时 `item/*` 是同一类型） | `thread/list` | `thread/name/set` | app-server（常驻） |
| Pi | `SessionManager.open(path)` 加上 `getBranch()`、`getTree()`、`getLeafId()` | `SessionManager.listAll()` | RPC `set_session_name` | 不需要；从用户自己安装的 pi 包加载 |

loom 只写一层薄适配，把官方返回的数据转成 Cindy 的 `Message` 行；转换规则复用 Cindy 的实时翻译器，所以历史和实时一致。格式变化由各家的读取实现负责。

B8 经用户确认，运行状态增加狭窄的只读尾读：Codex 的 task_started/task_complete/turn_aborted、Claude 的 system/turn_duration、Pi assistant 的 stopReason。首次从末尾 64 KiB 查找，最多 1 MiB；追加只读增量，截断或替换重建。5 分钟无写入显示未知；状态推测保持只读，审批与写入权继续由原客户端和既有运行通道裁决。未读只在 native-ui.json 保存实际显示过的 lastViewedAt 文件版本。

---

## 3. Engine Adapter 接口

设计取向：从 Cindy 的 `BaseAgent`（3000 行，其中大量是 bot、网关、远程字段）提炼出最小接口；能力声明沿用 Cindy 的 `CapabilityStatus` 形式（`supported`，或带原因的不支持）。

```ts
export interface EngineAdapter {
  readonly id: EngineId;                 // 'claude' | 'codex' | 'pi' | 'acp:<name>'
  readonly displayName: string;
  readonly icon: string;

  // —— 环境探测 ——
  probe(env: HostEnv): Promise<EngineProbe>;   // 二进制路径、版本、登录状态（只调用 CLI 自己的命令，不读凭据）
  capabilities(probe: EngineProbe): Capabilities;

  // —— 发现 ——
  roots(env: HostEnv): WatchRoot[];            // 要监听的目录和文件（含符号链接目标）
  classify(path: string): FileRole | null;     // session | subagent | sidecar-title | ignore
  // —— 解析（纯函数，可放到 worker 里跑）——
  summarize(file: FileHandle, prev?: SummaryState): Promise<SummaryResult>;  // 支持增量续读
  read(ref: SessionRef, opts: { branch?: 'active'|'all'; page?: Cursor }): Promise<Transcript>;
  extractSearchText?(item: TranscriptItem): string | null;

  // —— 运行 ——
  externalWriters(env: HostEnv): Promise<ExternalWriter[]>;  // 正在写入的外部进程（pid 文件、flock 探测）
  start(opts: StartOptions): Promise<LiveSession>;           // 新建会话
  resume(ref: SessionRef, opts: ResumeOptions): Promise<LiveSession>;
  fork?(ref: SessionRef, at: ItemAnchor): Promise<SessionRef>;   // 必须走官方 fork，不改文件
  terminalCommand(ref: SessionRef): TerminalCommand;          // 「在终端继续」：claude --resume <id> 等
}

export interface LiveSession {
  readonly ref: SessionRef | null;            // 新会话在拿到原生 id 之前为 null
  readonly events: AsyncIterable<LoomEvent>;
  send(input: UserInput, opts?: TurnOptions): Promise<void>;     // 开启新的一轮
  steer?(input: UserInput): Promise<void>;                        // 追加到进行中的轮次
  interrupt(): Promise<void>;
  respond(requestId: string, decision: ApprovalDecision | UserAnswer): Promise<void>;
  setOptions?(o: Partial<{ model; effort; permissionMode }>): Promise<void>;
  compact?(instructions?: string): Promise<void>;
  rename?(title: string): Promise<void>;     // 只走官方接口：claude rename_session、codex thread/name/set、pi set_session_name
  close(): Promise<void>;                    // 进程可以随时退出，事实都在原生文件里
}

export interface Capabilities {
  resume; fork; inFileBranching; steer; interrupt; approvals; planMode; manualCompact;
  renameNative; images; switchModelMidSession; subagents; turnDiff;   // 每项都是 CapabilityStatus
  models: ModelDescriptor[]; efforts: string[]; permissionModes: PermissionModeDescriptor[];
}
```

三家首批适配器的实现：

| | Claude | Codex | Pi |
| --- | --- | --- | --- |
| 运行通道 | `@anthropic-ai/claude-agent-sdk` 的 `query()`，`pathToClaudeCodeExecutable` 指向**用户自己安装的 `claude`**（按 PATH 查找，也允许手动指定路径；不下载、不托管二进制）；`resume: <sessionId>` | 一个 loom 持有的常驻 `codex app-server` 进程，多个 thread 复用；`thread/start`、`thread/resume {excludeTurns}`、`turn/start`、`turn/steer`、`turn/interrupt` | 每个活跃会话一个 `pi --mode rpc --session <path>` 进程；用 `prompt`、`steer`、`follow_up`、`abort` 控制，用 `agent_settled` 判断这一轮结束 |
| 审批 | SDK 的 `canUseTool` 回调，加上 `permissionMode` | server→client 请求 `item/*/requestApproval`、`item/tool/requestUserInput` | Pi 默认没有权限系统；扩展 UI 请求（`extension_ui_request`）透传 |
| 原生 id 回填 | 第一条 `system/init` 事件里的 `session_id` | `thread/start` 响应里的 `thread.id` | `get_state` 返回的 session 文件和 id |
| 终端命令 | `claude --resume <id>`（cwd 设为会话 cwd） | `codex resume <threadId>` | `pi --session <path>` |
| 改名（写回原生） | 控制请求 `rename_session`（SDK 的 `renameSession`），写入 `custom-title` 记录 | `thread/name/set`，写入 `session_index.jsonl` | `set_session_name`，写入 `session_info` 记录 |
| fork | `--fork-session` / SDK `forkSession` | `thread/fork {excludeTurns}`（不带它会出现 31MiB 单行，Cindy 有事故记录） | RPC `fork` / `clone` |
| 协议类型 | SDK 自带类型 | 构建时执行 `codex app-server generate-ts`，按支持的版本区间生成并提交到仓库 | 来自 pi 包的 RpcClient 类型 |

**通用 ACP 适配器**（第二批引擎）：`initialize`、`session/new`、`session/load`、`session/prompt`、`session/update`、`session/request_permission` 映射到上面的接口。发现和解析仍然由各引擎单独实现，因为 ACP 不负责「从磁盘列出会话」；`session/load` 可以兜底读取，前提是 agent 声明了 `loadSession` 能力。

---

## 4. 进程管理与流式事件模型

### 4.1 进程拓扑

```
（v2：实现上就是 Cindy 的 Electron main 加 IPC 契约；下图描述职责划分）
Electron main ──IPC(MessagePort)──> core（Electron utilityProcess；以后可以作为独立进程 `loom serve`）
                                      ├─ Indexer（worker_threads：扫描、解析、FTS）
                                      ├─ Watcher（@parcel/watcher）
                                      └─ Supervisor
                                           ├─ claude（每个活跃会话一个 SDK query / 子进程）
                                           ├─ codex app-server（全局一个，或者经 `codex app-server proxy` 连到已有的 daemon）
                                           └─ pi --mode rpc（每个活跃会话一个）
renderer ──同一套 wire 协议──> core
```

- core 从第一天起就**不依赖 Electron API**，和 renderer 之间只通过 JSON 可序列化的 wire 协议通信（请求、响应、通知，用 zod 定义）。远程和手机端以后复用同一套协议（§8）。
- 环境：启动时用 `$SHELL -ilc 'env'` 取一次登录 shell 的 PATH（GUI 进程拿不到 nvm 和 brew 的路径）；`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` 原样透传。**不注入任何凭据。**

### 4.2 进程生命周期

```
idle ─start/resume→ spawning ─握手成功→ ready ─send→ running ⇄ awaiting_input(审批/提问)
  ↑                    │失败                    │ done/interrupted
  └──── 本轮结束后短暂保留（默认 45 秒）/ 用户关闭 / 外部写入者出现 ←──┘
crashed：保留 stderr 尾部 64KB，UI 提示；会话照常可以从原生文件 resume
```

- **进程是可抛弃的，两轮之间不占着会话。** 因为事实在原生文件里，杀掉进程不丢任何东西。原则是：只要不在一轮之中，loom 就不应该是这个会话的写入者，这样用户随时可以在终端里 resume（参考 ccgui 的一轮一进程，它在终端互通上最稳）。
  - Claude、Pi：本轮结束后保留一小段时间（默认 45 秒，方便马上追问），然后释放进程；检测到外部写入者时立即释放。
  - Codex：app-server 常驻（省掉启动和 MCP 重启的开销），但本轮结束后对这个 thread 调用 `thread/unsubscribe`，把它卸载并放掉 `thread-writer-locks`，下次发送时再 `thread/resume`。**卸载后锁是否确实释放，实现前要先验证**；如果不行，退回 ccgui 的一轮一个 app-server 子进程。
  - 代价：冷启动多 1 到 3 秒（Claude 还要重新拉起 MCP 服务）。缓解办法：Claude 用 SDK 的 `prewarm()` 预先启动一个**不绑定任何会话**的备用进程，发消息时直接认领（它不持有任何会话，所以不违反单写入者规则）；Codex 的 app-server 本来就常驻；Pi 实测启动耗时后再决定要不要预热。
  - 例外：作为协作 Lead 的会话，在它的 Worker 还没有结束前，保留时间延长（§7.4）。
- 分帧：自己实现**只按 LF 切分**的 JSONL 读取器（Node 的 `readline` 会在 U+2028/2029 处断行，Pi 文档明确警告；Cindy 的 codex stdioTransport 用的就是 readline），单行上限 64MiB，超限时只丢弃这一行，不断开连接。
- 背压：持续读取 stdout；写 stdin 时遵守 `drain`。
- 版本门控：握手时记录 CLI 版本（Codex 取 `initialize` 返回的 userAgent，Claude 取 `system/init` 里的 version，Pi 取 `--version`），能力按版本开关（参考 Cindy 的 `version-gates.ts`）。

### 4.3 单写入者规则（P4 的核心）

同一个原生会话，任何时刻只允许一个写入者：

1. 发送前调用 `adapter.externalWriters()`：
   - Claude：读取 `~/.claude/sessions/*.json`，确认 pid 存活且 `procStart` 一致，再比对 sessionId。
   - Codex：对 `thread-writer-locks/<id>.lock` 做非阻塞 flock 探测（需要一个小的原生模块，或者用 `lsof` 兜底）；如果 loom 自己就是 app-server 的持有者，则以 `thread/loaded/list` 为准。
   - Pi：没有锁，用启发式判断（文件 mtime 在 30 秒内，并且存在 `pi` 进程的 cwd 匹配）；只给出提示，不强制拦截。
2. 检测到外部写入者时，会话显示「终端中运行」，**只读跟随**（watcher 实时刷新），输入框禁用，并提供「等对方结束后接管」。
3. loom 自己的进程在运行时，「在终端继续」会先结束 loom 进程，再复制或打开终端命令。

### 4.4 事件模型

```ts
type LoomEvent =
  | { t: 'session.bound'; ref: SessionRef }                         // 拿到原生 id
  | { t: 'turn.started'; turnId }
  | { t: 'item.started'; item: TranscriptItem }                     // 和 §2.3 同一个类型
  | { t: 'item.delta'; itemId; field: 'text'|'output'; append: string }
  | { t: 'item.completed'; item: TranscriptItem }
  | { t: 'diff.updated'; turnId; files: FileDiff[] }                // Codex turn/diff/updated；Claude、Pi 由 edit 工具汇总
  | { t: 'input.requested'; requestId; kind: 'approval'|'question'|'plan'; payload }
  | { t: 'input.resolved'; requestId }
  | { t: 'usage'; tokens; costUsd?; rateLimits? }
  | { t: 'status'; state: 'running'|'awaiting_input'|'compacting'|'retrying' }
  | { t: 'turn.completed'; turnId; outcome: 'ok'|'interrupted'|'error'; error? }
  | { t: 'error'; terminal: boolean; code; message };
```

**实时叠加层（live overlay）**：会话视图等于原生文件解析结果加上尚未落盘的实时 item。watcher 发现文件变化后重新增量解析，按 `native` 锚点或 item id 去掉已经落盘的叠加项。一轮结束后，界面上显示的一定就是原生文件的内容。这一点保证了「loom 看到的」和「终端 resume 看到的」完全一致。

### 4.5 diff 查看

三个来源，按优先级：
1. Codex `FileChange.changes` 和 `turn/diff/updated`（官方给出的 unified diff）；
2. Claude 的 `Edit`、`Write`、`MultiEdit` 工具（`toolUseResult.structuredPatch` 或 `old_string`/`new_string`），Pi 的 edit/write 工具（参数和 `details`）；
3. 工作区 `git diff`（和引擎无关，作为「本轮累计」和「当前工作区」视图）。

---

## 5. 派生索引设计

当前落地以 C1 / B7 为准：`index.sqlite` 只保存获批的九列原生元数据，`native-ui.json` 保存 UI UUID 绑定、用户偏好与未发送草稿的目录意图。下文 `ui.sqlite` 和消息全文索引是初期草案；当前原生链路使用官方接口现读，消息正文和工具输出只驻留内存。全文索引需要另行设计和确认。

### 5.1 存储布局

```
~/Library/Application Support/loom/
  index.sqlite     派生索引：删掉后重扫，结果必须完全一致
  ui.sqlite        UI 元数据：删掉后会话一个不少，只丢失置顶、标签和未完成的改名请求
  logs/
```

两个库分开存放，是为了让「删了重建」可以对 index 做到零代价，同时 UI 元数据不会跟着丢。

### 5.2 index.sqlite 表结构

```sql
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);          -- schema_version、每个引擎的 parser_version
CREATE TABLE files(
  path TEXT PRIMARY KEY,            -- realpath
  engine TEXT NOT NULL, role TEXT NOT NULL,        -- session | subagent | title-sidecar
  size INTEGER, mtime_ms INTEGER, ino INTEGER, dev INTEGER,
  head_hash TEXT,                   -- 前 4KB 的 hash，用于识别改写或替换
  parsed_bytes INTEGER,             -- 已增量解析到的偏移（只对纯 jsonl 有效）
  parser_version TEXT, state_json TEXT,            -- 增量折叠状态（计数、叶子、最后标题……）
  error TEXT
);
CREATE TABLE sessions(
  engine TEXT NOT NULL, native_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  cwd TEXT, workspace_key TEXT,     -- git 顶层 realpath；Codex/Claude worktree 归到主仓
  title TEXT, title_source TEXT,    -- custom | ai | first-message
  first_prompt TEXT, last_prompt TEXT,
  created_at INTEGER, updated_at INTEGER,
  message_count INTEGER, model TEXT, git_branch TEXT,
  parent_engine_id TEXT, relation TEXT,   -- fork | subagent | guardian | null
  native_archived INTEGER DEFAULT 0,      -- Codex 原生归档（archived_sessions 或 threads.archived）
  tokens INTEGER, cost_usd REAL, cli_version TEXT,
  PRIMARY KEY(engine, native_id)
);
CREATE INDEX idx_sessions_ws ON sessions(workspace_key, updated_at DESC);
CREATE TABLE messages(id INTEGER PRIMARY KEY, engine TEXT, native_id TEXT, seq INTEGER, role TEXT, text TEXT, ts INTEGER,
  UNIQUE(engine, native_id, seq));
CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='trigram');
-- 三个触发器保持 messages 和 fts 同步（沿用 ccgui 的写法）
```

- **trigram 分词器**：unicode61 无法对中文做子串匹配。少于 3 个字符的查询词走 LIKE 兜底（ccgui 已经验证过这个坑）。
- `messages` 只存可搜索的文本（用户和 assistant 正文、工具名），不存工具输出全文，控制库的体积。

### 5.3 ui.sqlite 表结构

```sql
CREATE TABLE session_overrides(engine, native_id, pinned INT, starred INT, hidden INT, PRIMARY KEY(engine, native_id));
CREATE TABLE pending_renames(engine, native_id, title TEXT, requested_at INT, PRIMARY KEY(engine, native_id)); -- 写回成功后删除
CREATE TABLE tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE, color TEXT);
CREATE TABLE session_tags(engine, native_id, tag_id, PRIMARY KEY(engine, native_id, tag_id));
CREATE TABLE workspaces(key TEXT PRIMARY KEY, alias TEXT, sort INTEGER, collapsed INT, hidden INT);
CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT);              -- 窗口状态、最近使用的模型偏好等
```

判定线：`kv` 里可以放「新建会话时默认用哪个模型」这种偏好，但**不能放「某个会话用的是哪个模型」这种事实**（ccgui 的 `session_models`、`session_providers` 不照搬）。会话的模型以原生记录为准。

### 5.4 增量扫描

1. **发现**：枚举各适配器的 `roots()`，只 `stat`，不读内容；用全部文件签名（path、size、mtime、ino）的 hash 做「一级闸门」（ccgui 的 tier1 gate），没有变化就直接结束。
2. **逐个文件判断**：
   - 签名不变：跳过；
   - 只变大，且 `head_hash` 不变，且是纯 jsonl：从 `parsed_bytes` 开始续读，用 `state_json` 继续折叠；**最后一行如果没有 `\n` 就当作不完整，不推进偏移**；
   - 变小、inode 变化或 `head_hash` 变化（Codex 迁移改写、Pi 版本迁移）：整个文件重新解析；
   - `.zst`：签名变了才重新解压；
   - 文件消失：先确认所在卷是否挂载（ccgui 的 `storage_attached`，避免外接盘拔掉后误删），再删除对应的行。
3. 摘要解析在 worker 里跑，每个引擎的 parser 是纯函数（便于用 fixture 做快照测试）。
4. FTS 是摘要之后的第二遍、优先级更低，只处理签名变化的会话。
5. **附加来源**：Codex 的 `session_index.jsonl`（标题）作为附属文件参与签名；`state_5.sqlite` 只在有需要时以只读方式查询（归档、标题兜底），读取失败时静默降级。这个库的 schema 是 Codex 私有的。

### 5.5 文件监听

- 用 `@parcel/watcher`（macOS 下基于 FSEvents，Cindy 也在用），监听各 root，以及 Pi 符号链接目标所在的目录。
- 每个文件 150ms 防抖，合并成批；正在打开的会话走「快车道」，变化后立即增量读取并推送到界面。
- **兜底对账**：FSEvents 可能丢事件或合并事件。所以窗口获得焦点时、每 5 分钟、从睡眠唤醒后，都各跑一次一级闸门扫描。

### 5.6 重建策略

- `meta.schema_version` 不一致：删库重建；某个引擎的 `parser_version` 不一致：只重建这个引擎的行。
- 设置里提供「重建索引」按钮，等价于删除 `index.sqlite`。
- **CI 不变量测试**：用脱敏后的真实 fixture 语料做三件事：扫描并导出快照；删库重扫，快照必须字节级一致；删除 `ui.sqlite`，会话数必须不变。

### 5.7 工作区分组

`workspace_key` = cwd 所在 git 仓库的 common dir 对应的主仓 realpath（带缓存）。这样 `~/.codex/worktrees/<name>/<repo>` 和 Claude 的 worktree 会归到主仓下面，并显示 worktree 标记；不是 git 仓库的就直接用 cwd。

---

## 6. 终端互通与外部变化

| 场景 | loom 的行为 |
| --- | --- |
| 终端里新建会话 | watcher 发现新文件，1 秒内出现在列表中 |
| 终端里继续 loom 的会话 | 先检测到外部写入者，界面切到只读跟随，实时追加 |
| loom 里继续终端的会话 | 确认没有外部写入者后，用 `resume` 接上 |
| 终端里 `/rename`、`/name` | 原生标题变化反映到列表。loom 不保存标题覆盖，标题只有原生这一个来源，终端和 loom 显示的标题始终一致 |
| loom 里改名 | 走引擎的官方改名接口写回原生（见 §3）。会话正被外部写入时不抢写：先记进 `pending_renames`，列表里暂时显示新标题并标注「待写回」，等外部写入者结束后再写回 |
| 终端里压缩或 rewind | 重新解析，显示压缩分隔条，按新的叶子显示 |
| Codex 迁移、压缩旧文件 | inode 或扩展名变化后整文件重新解析，`native_id` 不变，UI 元数据不受影响 |
| 删除会话 | MVP 不提供删除；以后只走官方途径（Codex `thread/delete`、`thread/archive`；Pi 删除文件时走 trash），并且要二次确认 |

---

## 7. 多 agent 协作（第一期就做）

### 7.1 目标

角色不固定：可以是 Claude 总领、Codex 实施、Pi review，也可以是 Codex 实施、Pi 和 Claude 交叉审查，或者用户自己当总领、手动派活。所以 loom 不做固定流程，而是提供**一套协作原语**，**任何会话（以及用户本人）都可以当 Lead**。

它和引擎自带的子 agent 不是一回事（Claude Task、Codex `spawn_agent`）：那些是同一引擎内部派生的，loom 只读出来、挂在父会话下面显示；这里是**跨引擎**协作，由 loom 编排。

### 7.2 协作原语（core 提供，UI 和 MCP 共用）

```ts
interface TeamOps {
  spawn(p: { lead: SessionRef | 'user'; engine: EngineId; cwd: string; task: string;
             role?: string; model?: string; effort?: string;
             access: 'readonly' | 'write'; snapshot?: 'head+dirty' | 'none' }): Promise<WorkerRef>;  // 立即返回，不等待完成
  send(to: SessionRef, text: string): Promise<void>;          // Lead 给 Worker 追加指示，或者 Worker 结果回投
  status(ref: SessionRef): Promise<{ state; lastTurnAt; lastAssistantText?; diffStat? }>;
  result(ref: SessionRef): Promise<{ lastAssistantText; turnDiff? }>;
  list(lead: SessionRef | 'user'): Promise<WorkerRef[]>;
  stop(ref: SessionRef): Promise<void>;
}
```

两个入口：
- **用户当 Lead**：会话页上的「派给…」「找…review」「把意见发回」按钮，以及协作面板。
- **agent 当 Lead**：core 在 loopback 上起一个 MCP 服务 `loom_team`（streamable HTTP，每个 Lead 会话一个 bearer token，token 绑定 Lead 的身份），工具就是上面这几个原语。

### 7.3 MCP 注入（只走启动参数，不改用户配置）

| Lead 引擎 | 注入方式 | 状态 |
| --- | --- | --- |
| Claude | Agent SDK `query({ mcpServers: { loom_team: … } })`，优先用 `createSdkMcpServer` 让工具直接跑在 loom 进程里（不走 HTTP）；`settingSources` **不传**（默认等于 CLI，会加载用户自己的 MCP、Skills、CLAUDE.md、hooks），绝不传 `[]` | 可行 |
| Codex | **按会话注入**：`thread/start` 和 `thread/resume` 的 `config` 参数里传 `mcp_servers.loom_team`，只给开启协作的会话加；兜底方案是 app-server 启动时用 `-c` 全局注入，并用 `_meta.threadId` 识别是哪个 Lead（Cindy `cindy_orca` 的做法） | 按会话注入是否生效**待实测**；token 走环境变量，不放进 argv |
| Pi | **不走 MCP**：`pi --mode rpc -e <loom 自带的 Pi 扩展>`，扩展用 `pi.registerTool()` 注册 `loom_team_*` 工具，通过 loopback 和 core 通信 | 可行；和用户用哪套 MCP 无关 |

**为什么 Pi 不走 MCP**：Pi 用户的 MCP 有两套实现，loom 要兼容两种（本机就是第二种）：
- Pi 内置 MCP（`builtin:mcp`，配置在 `~/.pi/agent/mcp.json`）；
- 第三方 `pi-mcp-adapter`（会把内置的替换掉，在 settings 的 `extensions` 里写入 `"-builtin:mcp"`；配置有 9 层优先级，`mcp-adapter.json` 是其中一层）。

两者对 `--mcp-config` 的处理不同（adapter 也注册了同名参数，还有 `PI_MCP_CONFIG_MODE=exclusive` 独占模式）；adapter 默认只暴露一个 `mcp` 代理工具，模型要先搜索才能调到 loom 的工具；两者在转录里记录的工具名也不一样。用 `-e` 加载 loom 自己的扩展可以绕开这些差异：不传 `--mcp-config`，不碰任何 MCP 配置，用户自己的 MCP 服务和其他扩展照常加载；两套 MCP 都关掉的用户也能用。

**效率**：协作工具只注入开启了协作的会话，普通会话不多花任何 token（写进全局配置的话，每个会话包括终端里的都要背着这些工具定义）。运行开销：Claude 在进程内调用，Codex 走本机 HTTP，Pi 扩展发布编译好的 JS、只在启动时加载一次。另外，写进用户配置还会让 loom 没运行时，终端每次启动都去连一个连不上的 MCP 服务，只用启动参数注入就没有这个问题。

结果：在终端里 resume Lead 会话时没有 `loom_team` 工具，只能看、不能派活。这是「不改用户配置」的代价，文档和 UI 里要写明。

### 7.4 回报机制

- `spawn` 立即返回 Worker 的引用，**不在工具调用里阻塞等待**（Claude 和 Codex 对 MCP 调用都有超时，Pi 默认 60 秒）。
- Worker 这一轮结束后，loom 把一条**用户消息**投递进 Lead 会话：`[loom] <engine>/<role> 完成：<最后回复摘要>（完整结果可以调用 result 查看）`。
  - Lead 空闲：resume Lead，开启新的一轮；
  - Lead 正忙：排队。Claude 用流式输入队列，Codex 用 `turn/steer` 或等这一轮结束，Pi 用 `follow_up`。
- Lead 也可以主动调用 `status` 和 `result` 轮询。
- 防失控：每个 Lead 的 Worker 数量上限（默认 4）、自动回投的轮数上限（默认 20），超出后停下来问用户。

### 7.5 和原则的关系

- **Worker 就是普通的原生会话**，在列表里显示，终端里照样能 resume。
- **团队关系从原生文件派生，不另外存储。** Lead 的原生转录里记录了它调用 `spawn` 的工具调用，以及返回结果。工具名因引擎和 MCP 实现而不同（`mcp__loom_team__spawn`、Codex 的 McpToolCall、Pi 扩展的 `loom_team_spawn`），所以**不按工具名识别**：`spawn` 的返回结果里固定带一个标记 `{"loomWorker":{"engine","id","role"}}`，索引器按这个标记识别。由此得到「谁是谁的 Worker」，写进 index 的 `team_edges` 表，删库重扫也能恢复。用户手动派活时没有 tool call 可以解析，这时 loom 在 Lead 会话里投递一条可识别的消息（`[loom] 已派给 <engine>：<task>（worker=<id>）`），同样写进原生文件，同样可以派生。所以 **`ui.sqlite` 里不存任何团队事实**。
- 回报是 Lead 会话里的普通消息，终端 resume 能看到完整的协作过程。
- 不搬上下文（P5 不受影响）：Worker 只拿到一段任务说明，代码它自己从工作区读。

```sql
-- index.sqlite 新增（派生）
CREATE TABLE team_edges(lead_engine, lead_id, worker_engine, worker_id, role TEXT, access TEXT,
  spawned_at INTEGER, source TEXT,   -- mcp-tool | user-message
  PRIMARY KEY(worker_engine, worker_id));
```

### 7.6 冲突与安全

- **写冲突**：同一工作区同一时刻只允许一个 `access:'write'` 的会话在跑（包括 Lead 自己）；第二个写入请求会排队，或者报错交给 Lead 决定。需要并行实施时，第一期可以选「新开 git worktree」（参考 Cindy 的做法），worktree 会自动归到主仓的工作区下。
- **只读强制**（MCP 工具和扩展工具都要算在内，因为它们不受文件沙箱约束）：
  - Codex：`sandbox: read-only`；MCP 工具调用要求审批或者禁用（按 thread 覆盖 MCP 配置的能力需要先验证，Cindy 记录过 0.145 起支持按 thread 的插件配置）。
  - Claude：`permissionMode: 'plan'`，或者通过 `disallowedTools` 禁用 Edit、Write、MultiEdit、NotebookEdit 和 `mcp__*`；Bash 用 `canUseTool` 按规则拦截。
  - Pi：`--tools read,grep,find,ls --exclude-tools 'mcp*'`。`--tools` 白名单默认**保留** MCP 工具，`mcp*` 同时覆盖内置 MCP 的 `mcp__*` 和 pi-mcp-adapter 的 `mcp` 代理工具；用户扩展注册的工具（比如 `pi-interactive-shell`）不在白名单里，所以会被关掉。实现时要验证白名单对扩展工具确实生效。
- **审查快照**：`snapshot:'head+dirty'` 时，记下 HEAD 和未提交改动的 diff，写进任务说明（「审查相对 <sha> 的以下改动」），reviewer 看的是一个固定的版本。
- **审批**：Worker 的审批请求会冒泡显示在协作面板里，统一由用户处理；Lead agent 不能替用户批准。

### 7.7 UI

- 会话列表里，Worker 缩进显示在 Lead 下面，带引擎图标、角色名和状态。
- 会话页的协作面板显示 Lead 加上当前选中的 Worker，宽屏时左右分屏（参考 Cindy 的 `OrcaSplitView`）。
- Lead 会话里的 `spawn` 和回报消息渲染成卡片，点击可以跳转到对应的 Worker。

---

## 8. 远程与手机的分阶段路线

> B7：远程和手机端复用 Cindy 的 device-link、官方中转与同账号设备发现。Cindy 登录为可选能力，入口只在「设置 → 远程连接」；未登录时本地功能完整可用，SSH 照常显示。账号服务独立于本地数据：owner 始终为 `local-v1`，登录、退出、换账号保持原生索引、会话、UI 元数据和设置的归属。token 只用于远程认证及 device-link，三个引擎继续使用用户自己的 CLI 登录态。自建中转沿用独立 `CindyRelay` 凭据，账号 Bearer 只发送到所选官方服务。loom 保留自身 bundle id、scheme、UA 与版本。具体实施与验证见 [`b7-remote-auth-plan.md`](b7-remote-auth-plan.md)。下表记录长期阶段，当前优先接通现有实现。

B7 经用户确认统一会话身份：GUI `Session.id` 为 UUID，原生引用 `{engine, nativeId}` 由主进程集中绑定和解析，三引擎、桌面和 device-link 使用同一规则。新建采用调用方 UUID；终端发现的会话稳定派生 UUID。绑定与用户偏好只放在 `native-ui.json`，索引字段保持原生 id；消息仍通过官方接口现读。清除 loom 数据后会话事实完全重建，旧手机链接可能需要重新选择会话。原生来源通过明确元数据传递，缓存和写操作依据来源裁决。

B7 实测由 device-link WS 的 hello / ping-pong 与 presence 维持设备在线；官方手机连接超过 30 分钟，HTTP heartbeat 请求为 0，继续保持删除。认证和 device-link 使用 `loom/<实际版本>`；用户授权仅人机验证 WebView 使用运行时原生 Chromium/Electron UA。侧栏账号名称只作展示，本地数据归属保持 local-v1。

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| R0（MVP） | core 跑在 utilityProcess 里，wire 协议走 MessagePort | 无 |
| R1 | `loom serve`：无界面 core 加 WebSocket（token 鉴权），renderer 构建成 Web 版；局域网或 Tailscale 访问；先只读，再开放控制 | wire 协议稳定 |
| R2 | 手机端（Expo）作为 wire 协议的客户端：会话列表、流式渲染、审批、发送；二维码配对 | R1 |
| R3 | 公网连通：参考或搬运 Cindy 的 `device-link-relay`（Apache-2.0，约 2.6k 行，WS 中转内核）做自托管中继，配对和端到端加密自己设计 | R2 |
| R4 | 远程主机：通过 SSH 在远端启动 `loom serve --stdio`（对应 Cindy `maker-cc-manager`、`maker-pi-manager` 的思路）。**远端的原生文件就是远端的事实源**，本地只缓存它的派生索引 | R1 |

关于 Cindy 中继能否自托管：后端 `cindy-server` 不开源，官方中转依赖它；但仓库里已经有自建中转内核 `packages/device-link-relay`，和官方线协议兼容（见 `docs/self-hosted-relay-plan.md`，2026-10-28 的状态是：内核已实现，部署和加入流程尚未开始）。自建中转使用独立的设备加入与审批流程；官方远程直接沿用 Cindy 账号和设备发现。

---

## 9. 参考代码的取舍清单

> v2：以 Cindy 为底子之后，下面 9.1 的「搬运、改写、丢弃」要改成「保留、替换、删除」的视角。完整的删改清单在建仓库之前单独列出、确认。

### 9.1 Cindy（Apache-2.0；搬运的文件保留原版权头，加上 `Modified by loom` 注释，仓库根目录放 NOTICE）

**整体搬运（小改）**

| 文件 | 原因 |
| --- | --- |
| `agents/claude-code/claude-projects-fs.ts`（90 行） | 路径解析、realpath 加 NFC、超长 key 的兜底；只依赖 node 内置模块 |
| `agents/codex/app-server/client.ts`、`transport.ts`、`stdioTransport.ts` | JSON-RPC 客户端；需要把 readline 换成只按 LF 切分的读取器 |
| `agents/codex/version-gates.ts` | 按版本门控的模式，以及已知的版本坑（rollback 在 0.156 被移除、fork 需要 `excludeTurns`） |
| `agents/pi/rpc-client.ts`、`transport.ts` | Pi RPC 客户端；需要去掉 `@cindy/maker-shared` 依赖 |
| `agents/pi/session-tree.ts`、`session-jsonl-scan.ts` | Pi 树结构和流式扫描 |
| `agents/shared/async-queue.ts`、`context-overflow-error.ts`、`overload-error.ts`、`network-error.ts` | 通用工具和错误分类 |
| `agents/claude-code/invalid-resume.ts` | resume 失败的识别 |

**改写（参考思路，重新实现）**

| 模块 | 改写方向 |
| --- | --- |
| `agents/base-agent.ts`（3034 行）、`types/capabilities.ts`、`types/events.ts` | 提炼成 §3 的 `EngineAdapter` 和 `Capabilities`，以及 §4.4 的 `LoomEvent` |
| 三个 `translator.ts`（共 6.3k 行） | 翻译成统一的 `TranscriptItem` 模型；保留其中的错误分类和边界情况处理 |
| `claude-code/index.ts`（8.2k 行）、`codex/index.ts`（15.6k 行）、`pi/index.ts`（9.9k 行） | 只取 SDK 和进程接线的部分，bot、网关、记忆、自动审查全部去掉 |
| `codex/app-server/host.ts` | 一个进程服务多个 thread 的思路可以保留，去掉代理和凭据隔离 |
| `claude-code/env-builder.ts`、`codex/env-builder.ts` | 只保留 PATH 和配置目录透传，去掉 auth-adapter |
| `apps/desktop/src/renderer`（约 52 万行，React 19 + Tailwind + Radix + tanstack-virtual + CodeMirror + xterm） | 技术栈照搬；消息列表、工具卡片、diff 组件参考它的交互，重新写一个精简版 |
| `packages/design-tokens`（DTCG） | 设计 token 的组织方式可以借鉴，配色和字体 loom 自己定 |
| `apps/cindy-headless`、`maker-cc-manager`、`maker-pi-manager` | R1 和 R4 阶段参考无界面运行和 SSH 远程的结构 |
| `device-link`、`device-link-relay` | R3 阶段参考，或者直接搬运中继内核 |
| `orca-workflow`、`maker-ipc/orca*`、`docs/dev-rules/orca-team-architecture.md`（Lead 和 Worker 协同） | §7 的协作参考：Codex 用全局 MCP 加 `_meta.threadId` 识别 Lead、回报投递、Worker 上限、分屏 UI、worktree；团队记录存储不搬 |

**丢弃**

| 模块 | 原因 |
| --- | --- |
| `apps/desktop/src/main/localDb` 里的会话和消息存储（136 个迁移） | 平行会话层，违反 P1 和 P2 |
| Session Import、`transcript-relocation.ts` | 平行层的派生功能 |
| `fork-jsonl-repair.ts`、`jsonl-tool-id-normalize.ts`、`codex/rollout-sanitize.ts` | 会改写原生文件，违反 P1 |
| 引擎切换 handoff | 违反 P5 |
| Orca 的团队和派活记录存储（存在 Cindy 库里） | 违反 P2；loom 从 Lead 的原生转录里派生团队关系（§7.5） |
| 托管模型、计费、端点清单、`heartbeat-client`、组织/企业 SSO | 与本地执行和远程配对无关；`auth-client` 按 B7 仅保留个人远程登录、续期与退出 |
| **magpie 类模型层**：`anthropic-compat-proxy`（17.7k 行）、`anthropic-responses-bridge`、`responses-anthropic-bridge`、`responses-chat-bridge`、`model-compat`（14k 行）、`model-providers`（13.4k 行）、BYOM、供应商分享 | 违反 P3（模型网关聚合、另存凭据） |
| `shared/auto-review*`（6.7k 行）、`loop-guard`、bot、IM（`lizi-im`、`wechat-ilink`、`slack-hook-protocol`）、语音、远程桌面、浏览器控制、记忆、SkillHub、调度器 | 和 loom 的核心目标无关 |

### 9.2 ccgui（MIT，可以参考实现）

| 借鉴 | 文件 |
| --- | --- |
| 一级闸门加逐文件 stat 的增量扫描；删除和扫描之间的一致性；挂载点检测，避免误删 | `history/scanner.rs` |
| 发现：只读头部的 peek、各引擎目录枚举 | `history/discovery.rs` |
| trigram FTS 加 LIKE 兜底，外部内容表加触发器 | `history/search.rs`、`db.rs` |
| 标题和预览的去噪（`<local-command-*>`、`<command-name>`、system-reminder 等包裹层），带派生版本号 | `history/extract.rs` |
| Codex 标题来自 `session_index.jsonl` | `history/codex_titles.rs` |
| app-server 的线协议细节：`turn/completed` 不带用量、失败也通过 `turn/completed` 表达、plan 模式 | `engine/codex_app.rs` 文件头注释 |
| 不采纳：`session_models`、`session_efforts`、`session_providers`（把事实存进了 app 自己的库）、`plan_reviews`（审批事实源在 app 库里） | `db.rs` |

### 9.3 关于 magpie

magpie（yetone/magpie，Go，MIT）是本地模型网关（`127.0.0.1:3425`，在 OpenAI Chat、Responses、Anthropic Messages、Gemini 之间互转），加上 agent 配置改写和订阅、路由、故障转移。Cindy 自带了一套等价的东西（见 §9.1 丢弃清单）。loom 的立场是：**不内置，不冲突。** loom 启动的就是用户的官方 CLI，CLI 读自己的配置；如果用户用 magpie 把 Claude Code 指向 Kimi，loom 自然就跑在 Kimi 上。loom 唯一要做的是正确显示原生记录里的实际模型名。

---

## 10. 风险

| 风险 | 证据 | 应对 |
| --- | --- | --- |
| **上游格式变化** | Claude 2.1.312 新增 `api-request*`、`atis-latch`、`cost-state`、`relocated` 等记录；Codex 把所有旧 rollout 迁移成 paginated 格式并压缩成 zst；Pi 有 v1→v3 迁移 | 解析器宽容（未知记录转成 `unknown` item，不崩溃）；按引擎维护 `parser_version`；按 CLI 版本维护脱敏 fixture 语料；CI 里用当前安装的 CLI 跑一次冒烟测试（新建会话、解析、比对） |
| **CLI 版本兼容** | Codex 0.156 移除了 `thread/rollback`；ChatGPT.app 内置的 codex 和 Homebrew 装的 codex-cli 可能是不同版本，却写同一个 `CODEX_HOME`；Agent SDK 和 CLI 的版本耦合 | 握手时取版本，能力按版本门控；Codex 协议类型按支持区间生成；设置页显示每个引擎的版本，以及「已验证」或「未验证」状态 |
| **并发写同一会话** | Claude 没有锁，两个进程同时追加会产生分叉链；Codex 有 flock；Pi 什么都没有 | §4.3 单写入者规则；读取时忽略没有换行符的尾行；Pi 只能给出提示 |
| **大文件和性能** | Codex 单个 rollout 可达几十 MB（`history_base` 的 `end_byte_offset` 达到 19MB）；本机 Codex 有 1070 个 rollout | 摘要增量续读；放在 worker 里；转录分页（Codex 优先用 `thread/items/list`，按需读取）；zst 不重复解压 |
| **上游私有库不稳定** | `state_5.sqlite` 已经是第 5 版 schema | 只作可选的补充信息，只读，失败时降级，不作为必需依赖 |
| **会话目录被重定向** | Pi 的 session-hub 符号链接；`sessionDir` 设置；`CLAUDE_CONFIG_DIR` | 适配器从环境变量和设置读取根目录；跟随符号链接并按 realpath 去重 |
| **隐私** | FTS 库里有对话正文 | 只在本地，文件权限 0600；可以关闭全文索引；日志里不写正文 |
| **协作失控** | Lead 和 Worker 之间自动回投可能循环；多个 Worker 同时写同一工作区 | Worker 数量和回投轮数都有上限；同一工作区同时只允许一个写入的 Worker；reviewer 强制只读；所有审批都交给用户 |
| **工具注入差异** | Pi 有两套 MCP 实现（内置和 pi-mcp-adapter），行为和工具名都不同；Codex 的 MCP 配置在 app-server 启动时就固定了 | Pi 改用 `-e` 加载 loom 扩展，不依赖 MCP；Codex 的 `loom_team` 在 app-server 启动时就注册，按 threadId 鉴权；团队关系按返回结果里的标记识别，不按工具名 |
| **订阅条款** | 用第三方 GUI 驱动订阅登录态 | loom 只调用用户本机的官方 CLI，不代理、不转发凭据；条款要在 README 里提示用户自行确认（待核实各家条款） |

---

## 11. MVP 范围

**包含**

1. 桌面端（macOS arm64 优先），Electron，界面文案默认中文。
2. 三个引擎都能新建和继续会话：Claude（Agent SDK + 用户自己安装的 `claude`）、Codex（app-server）、Pi（RPC）。
3. 统一的会话列表：按工作区分组（git 主仓归并，带 worktree 标记），每条带引擎图标，显示标题、更新时间、外部运行状态；支持搜索（标题 + FTS）；改名写回原生（三个引擎都走官方接口）；UI 元数据只有置顶。
4. 流式渲染：文本、思考、工具卡片、子 agent 折叠（只读）、压缩分隔条、审批和提问卡片、中断。
5. diff 查看：工具调用级 diff，加上本轮累计 diff（Codex 用官方 diff，其余由 edit 工具汇总），以及工作区 `git diff`。
6. 「在终端继续」按钮（复制命令，或打开 Terminal/iTerm），以及外部写入者检测和只读跟随。
7. 索引不变量测试，以及「重建索引」按钮。
8. **多 agent 协作（§7）**：协作原语；用户当 Lead 的 UI（派活、找人 review、把意见发回）；`loom_team` 工具，让 Claude、Codex、Pi 都能当 Lead（Claude 和 Codex 通过 MCP 注入，Pi 通过 loom 扩展注入，兼容内置 MCP 和 pi-mcp-adapter 两种用户配置）；异步回报；只读 reviewer 和审查快照；团队关系从原生文件派生；Worker 缩进显示在 Lead 下面，加上 Lead 和 Worker 分屏。

**不包含（后续）**：in-file 分支的可视化编辑（Pi `/tree`、Claude rewind）、删除和归档、ACP 通用适配器、更多引擎、远程和手机端、协作流程模板、跨 Lead 共享 Worker。

### 11.1 终端互通验证用例

| # | 步骤 | 预期 |
| --- | --- | --- |
| T1 | loom 新建 Claude 会话，聊 2 轮，关闭 loom 进程；终端执行 `claude --resume <id>` 再聊 1 轮 | 终端里能看到完整上下文；loom 列表 2 秒内更新为 3 轮 |
| T2 | 终端 `claude` 新建会话后退出；在 loom 里继续 | 会话出现在正确的工作区下，标题正确；继续后终端 `--resume` 能看到 loom 里的那一轮 |
| T3 | 同 T1 和 T2，换成 Codex（`codex resume <id>`），再加上 ChatGPT/Codex App 里新建的 thread | 同上；Codex App 正在运行某个 thread 时，loom 显示「外部运行中」，并且不允许发送 |
| T4 | 同 T1 和 T2，换成 Pi（`pi --session <path>`）；终端里 `/name`、`/compact` | 标题和压缩分隔条都反映到 loom |
| T5 | 终端里会话正在跑一个长任务，同时在 loom 打开这个会话 | 只读跟随、实时追加，输入框禁用；终端结束后可以接管 |
| T6 | loom 的一轮进行到一半时强制退出 loom | 原生文件完好；终端 resume 能继续；重新打开 loom 后状态正确 |
| T7 | 删除 `index.sqlite` 后重启 | 列表、标题、计数和删除前的快照一致 |
| T8 | 删除 `ui.sqlite` 后重启 | 会话一个不少，标题也不变（标题在原生文件里），只是置顶消失 |
| T9 | 设置 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME` 指向别的目录后启动 | loom 读取和写入的都是重定向后的目录 |
| T10 | 在 loom 中分别给 Claude、Codex、Pi 会话改名，然后在终端打开 `/resume` 选择器 | 终端里显示新标题；原生文件里只追加了官方的改名记录（`custom-title`、`session_index.jsonl`、`session_info`），loom 自己没有写任何一行 |
| T10b | 会话正在终端里运行时，在 loom 中改名 | 不抢写；标注「待写回」；终端退出后自动写回 |
| T11 | Codex 子 agent 和 Claude 子 agent 会话 | 不出现在主列表；在父会话里可以展开查看 |
| T12 | 两轮之间（进程已释放），在终端执行 `codex resume <id>` | 不会撞上 thread-writer-lock；终端可以正常继续 |
| T13 | Claude 当 Lead：spawn 一个 Codex Worker（写）实施，再 spawn 一个 Pi Worker（只读）review | 两个 Worker 都出现在 Lead 下面；完成后的回报作为用户消息出现在 Lead 会话里；Pi Worker 无法修改文件 |
| T14 | T13 完成后，删除 `index.sqlite` 和 `ui.sqlite`，然后重启 | 团队关系完整恢复（从 Lead 的原生转录派生） |
| T15 | 在终端执行 `claude --resume <Lead id>` | 能看到完整的派活和回报记录；没有 `loom_team` 工具，属于预期行为 |
| T16 | 用户当 Lead：在 Codex 会话里点「找 Claude review」，再「把意见发回」 | Claude 拿到固定的审查快照；意见作为用户消息进入 Codex 会话；T14 同样成立 |
| T17 | 一个写入的 Worker 正在运行时，再 spawn 一个写入的 Worker 到同一工作区 | 排队或者报错，不会并发写 |
| T18 | Pi 当 Lead，在三种用户配置下各跑一次：①内置 MCP，②pi-mcp-adapter（`-builtin:mcp`），③两者都关闭 | 三种情况下 `loom_team_*` 都能直接调用；用户自己的 MCP 服务照常可用；`settings.json`、`mcp.json`、`mcp-adapter.json` 内容不变（比对 hash） |
| T19 | 「卸载 loom」：删除 loom 的整个数据目录，然后只用终端 | `claude`、`codex`、`pi` 的会话一个不少，`--resume` 和 `/resume` 都正常；各 CLI 的配置文件和 loom 安装前逐字节一致（比对 hash） |

---

## 12. 仓库策略（v2）

- **不保留 Cindy 的 git 历史**。新建 loom 仓库，前两个提交是：
  1. 导入 Cindy 某个提交的**原样快照**（一个字不改）。提交信息、`NOTICE` 和 `UPSTREAM.md` 都记下上游 SHA。
  2. 大删改：删掉平行层和不要的功能，替换品牌素材。
- **吸收上游修复**：靠挑着移植，不靠 merge。由于第 1 个提交和上游的文件完全相同，可以用 `git -C reference/cindy diff <基线>..<修复> -- <路径> | git apply -3` 做三方合并。
- **许可**：Apache-2.0 要求保留 LICENSE 和 NOTICE、注明改动；Cindy 的名称和品牌素材全部替换。
- 目录结构沿用 Cindy（`apps/desktop`、`apps/mobile`、`packages/*`），loom 新增的代码（官方读取适配、派生索引、协作）放在新的 packages 里。下面原来的 monorepo 草案只作为职责划分参考。

### 12.1 原 monorepo 草案（v1，仅作参考）

```
loom/
  packages/
    protocol/        wire 协议（zod）、TranscriptItem、LoomEvent、Capabilities
    core/            Indexer、Watcher、Supervisor、TeamOps、loom_team MCP server、wire server；纯 Node
    engine-claude/   engine-codex/（包含生成的协议类型）  engine-pi/（包含 loom 的 Pi 扩展，用 -e 加载）
    ui/              React 组件（消息、工具卡片、diff、会话列表）
  apps/
    desktop/         Electron（main + preload + renderer），core 跑在 utilityProcess 里
  fixtures/          脱敏后的原生会话语料（按 CLI 版本）
```

技术栈：TypeScript、pnpm、Electron、React 19、Vite、Tailwind、Radix、`@tanstack/react-virtual`、`better-sqlite3`（FTS5 trigram）、`@parcel/watcher`、zod、vitest。

---

## 13. 决策记录

| # | 问题 | Cindy | ccgui | loom | 状态 |
| --- | --- | --- | --- | --- | --- |
| D1 | Claude 怎么运行 | Agent SDK + Cindy 下载的托管二进制，可以改写 `CLAUDE_CONFIG_DIR` | 用户自己安装的 `claude`；每轮一个进程：`-p --resume`，stream-json 输入输出 | Agent SDK + **用户自己安装的 `claude`**（按 PATH 查找，也可以手动指定）；不托管二进制，不改配置目录；SDK 不兼容时退回直接调用 CLI 的 stream-json | 已定 |
| D2 | Codex 进程归属 | 本机一个常驻 app-server；daemon 只用于 SSH 远程 | 每轮一个 app-server 子进程 | 常驻 app-server，每轮结束后 `thread/unsubscribe` 放锁（§4.2）；不行就退回每轮一个进程；`proxy` 连接 daemon 留作后续 | 已定（实现前先实测 T12） |
| D3 | 标题 | 存 Cindy 自己的库；只有 Pi fork 时写回原生 | `custom_title` 作为 UI 覆盖；不写回原生 | **写回原生，并且只走官方接口**：Claude `rename_session`、Codex `thread/name/set`、Pi `set_session_name`；loom 不保存标题覆盖；外部正在写时延后写回。待验证：Claude 的 `rename_session` 不发消息时能否调用，不行就在下一轮开始时带上 | 已定 |
| D4 | 多 agent 协作 | Orca：Lead 通过 MCP 派活给跨引擎的 Worker，团队记录存在 Cindy 库里 | 任务工作台：AI 生成 JSON 流程，节点就是普通的引擎运行 | 协作原语加 `loom_team` MCP，任何会话或用户都能当 Lead，团队关系从原生文件派生（§7） | **已定：第一期做** |
| D5 | 进程生命周期 | 常驻 | 每轮一个进程 | 两轮之间不持有写入者（§4.2） | 已定 |
| D6 | 实现基线 | — | — | 以 Cindy 为底子往下删，保留界面、样式、设置、插件、远程（§1.1） | 已定 |
| D7 | 仓库历史 | — | — | 不保留 git 历史，导入原样快照后再删改（§12） | 已定 |
| D8 | 读取原生会话 | 导入时自己解析（Claude 线性读；Codex 不支持 zst） | 自己解析（线性读；Codex 不支持 zst） | 三家正文、分支和工具语义使用官方读取接口（§2.4）；B8 按用户要求增加有界只读尾部状态边界，限 task_started/task_complete、turn_duration、stopReason，不据此审批或接管 | 已定 |
