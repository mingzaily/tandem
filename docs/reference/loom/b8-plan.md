# B8：原生上下文一致性与外部任务实时更新

> 2026-11-02。A 段已实施并逐项提交；下文保留第 0 步调查与拟议方案。用户随后回复“继续吧”，B 段按 §7 开始实施。

## 0. 范围、证据与 A 段结果

目标：同一原生会话在 loom 与终端中使用相同上下文和用户配置的工具。普通任务删除 loom/Cindy 的默认增补。保留功能确实需要的输入和工具逐项说明，作为明确例外交用户确认；历史原生文本保持原样。

本次读取 `AGENTS.md`、`UPSTREAM.md`、architecture、native projection、B7 §8 和涉及模块的工程说明。证据包括当前源码、已安装 CLI 源码、现有进程 argv/环境变量名、现有 MCP 服务的 `initialize` / `tools/list`、现有原生记录的结构与有界尾部。MCP 调查没有执行业务工具，没有创建 CLI 会话或发送模型请求。进程环境的凭据值只在内存用于本机鉴权，文档和调查输出仅保留工具名、变量名、非密运行标记和计数。

| A 段项目 | 提交 | 实际验证 |
| --- | --- | --- |
| A1 三处“任务 / tasks”文案，只改 zh-CN、en | `dc9ca25c` | desktop/mobile typecheck 退出 0；术语检查通过；2 文件 / 4 用例通过；UI 332/332，通过后查看总览和远程账号截图。 |
| Codex 取消提问清理，上游 `3812eec68e` | `3ab8b6ff` | `git apply -3` 干净应用；两端 typecheck、maker-core build 退出 0；1 文件 / 968 用例通过，11 跳过。原生和动态问题均覆盖取消后完成、重复取消与迟到回答。 |
| `+` 面板搜索框，上游 `ca34d72908` | `fd7092f4` | `git apply -3` 后解决 AtMentionPanel import 冲突；两端 typecheck 退出 0；2 文件 / 30 用例通过；新增真实 ExtraDirsButton、MorphPopover、AtMentionPanel 场景，UI 4/4 通过并查看总览。ChatInput 扫描和焦点返回以其单测验证。 |
| 导航性能，上游 `849315e54b` 的 mapper、slashCommands、MainLayout | `2ca6633e` | `git apply -3` 干净应用；两端 typecheck 退出 0；3 文件 / 74 用例通过。mainEntryPreference、MainEntryRedirect、skillhub 均跳过。 |
| 删除 `maker-host/claude-behavior-flags.ts` | `6ba3c79e` | 删除前全仓搜索仅有自身定义；两端 typecheck 退出 0；runtimeConfigs 1 文件 / 2 用例通过。 |
| desktop 版本 `0.1.121` | `5bb14eed` | 两端 typecheck 退出 0；实际 package.json 版本断言通过。 |
| UPSTREAM.md 审计与对应版本 | `e0c24b50` | 审计表与 `5f0b5f42..v0.1.121 --no-merges` 的 23 个提交逐项相等：3 个移植、20 个跳过；diff 检查通过。直接比较两个上游版本标签是 106 个，本仓库起点为含 v0.1.120 的导入快照。 |

实际命令：每项代码提交前运行 `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck`；maker-core 使用 `pnpm --filter @cindy/maker-core run build`（tsc --noEmit）。相关测试见表中路径对应的 `pnpm exec vitest run <文件>`。UI 使用 `pnpm ui:check --changed --theme all --locale all`，另按工程说明运行了不带 locale 的 changed 检查。

批次收尾实际结果如下，保持测试断言与原有超时：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck` | 在 A1、三个移植、死文件、版本号的六个检查点分别运行，均退出 0、0 错误；UPSTREAM 文档复用最后一次相同代码状态的结果。 |
| `pnpm --filter @cindy/maker-core run build` | tsc --noEmit，退出 0。 |
| `pnpm check:i18n-glossary` | 退出 0，新增违规 0；既有待裁决 lead 告警 1 处。 |
| desktop `pnpm exec vitest run src/renderer/features/cc-agent/sidebar/__tests__/MainListScopeHeader.test.tsx src/renderer/__tests__/remoteAccountChatBoundary.test.ts` | 2 文件 / 4 用例通过。 |
| maker-core `pnpm exec vitest run src/agents/codex/index.test.ts` | 1 文件 / 968 用例通过，11 跳过。 |
| desktop `pnpm exec vitest run src/renderer/components/new-chat/__tests__/atMentionPanelSearch.test.tsx src/renderer/components/new-chat/__tests__/chatInputAnnotationAbort.test.tsx` | 2 文件 / 30 用例通过；初次命令还带了一个仓库里不存在的 atMentionPanel.test.tsx 路径，Vitest 实际选中上述两文件。 |
| desktop `pnpm exec vitest run src/main/localDb/__tests__/mapperMarkdownPreview.test.ts src/renderer/__tests__/slashCommandsDeviceId.test.ts` | 2 文件 / 33 用例通过；初次命令还带了不存在的 MainLayout.test.tsx 路径，实际选中上述两文件。 |
| desktop `pnpm exec vitest run src/renderer/lib/__tests__/slashCommands.test.ts` | 1 文件 / 41 用例通过。 |
| desktop `pnpm exec vitest run src/main/maker-host/__tests__/runtimeConfigs.test.ts` | 1 文件 / 2 用例通过。 |
| `cd apps/mobile && pnpm exec vitest run` | **692 文件 / 9,729 用例通过，0 失败，186.58s**。 |
| `cd apps/desktop && pnpm exec vitest run --maxWorkers=2` | **2,226 文件通过、1 文件失败、5 文件跳过；32,928 用例通过、1 失败、32 跳过；1,072.96s**。唯一失败为 filePeer 旧附件格式上传的原有 5,000ms 超时。 |
| desktop `pnpm exec vitest run src/main/device-link/__tests__/filePeer.test.ts` | **1 文件 / 64 用例通过，21.66s**；同一旧格式用例 838ms。 |
| desktop `pnpm exec vitest run src/main/device-link/__tests__/filePeer.test.ts -t 'uploads blocks'` | **2 用例通过、62 因筛选跳过，8.41s**；旧格式用例 931ms。 |

filePeer 实现与测试在 A 段差分中均为 0 改动；全量运行触发时间门限，原逻辑随后两次通过。该并发全量运行的时间稳定性仍是验证限制，全量结果保留为 1 失败；不改保留功能断言、不抬超时掩盖它。详细原始日志在本机 `/tmp/loom-b8-checks/`。

A 段业务逻辑审查核对取消问题的单次终态、迟到回答隔离、搜索/目录钻取/输入法与焦点、缓存新鲜度及请求隔离。代码设计审查复用现有取消入口、删除失去调用方的焦点回调、保留有界纯投影缓存与在途请求合并，当前变更没有已知阻塞问题。`pnpm design:inventory` 因既有 catalog 仍登记已删除的 `/plugins` 路由退出 1，本批未修改生成器或照搬上游生成清单。第一次沙箱内 Electron UI 启动失败，沙箱外按原场景通过；新增 UI 场景首次使用了错误翻译 key，改用已有 key 后通过。

## B1. 模型输入与工具增补

### 1.1 三个引擎的实际接线和持久化

“原生写入”指官方 CLI 接受输入后自行持久化，loom 不直接写原生文件。系统段也按可能进入原生记录处理：本机 Claude 文件存在 `api-request-blob` 的 system 快照，Codex 有 `response_item` 的 developer 消息和 session_meta 指令，Pi 有 `message.role=system` 快照。当前 Pi `67a4414e…` 的 system 记录实际包含 Cindy 身份与 answer-delivery 段；其整条记录约 158 KB，还包含原生及项目内容，不能全部归为 loom 增补。Claude 样本未命中 Cindy 身份，不能用这一个样本判定 SDK append 永远不会被记录。

| 引擎 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `agents/claude-code/index.ts:buildClaudeSystemPromptAppend` 将 answer delivery、engine append、设备托管说明、memory、contacts、插件 roster、host prompt、MEMORY 索引、userPrompt 依序拼入 SDK `claude_code` preset 的 append；`buildMcpServers()` 合入 SDK MCP。用户/项目原生配置照常加载。 | 用户输入、工具调用/结果会；系统内容可进入 CLI 请求快照。 | 普通执行只依赖 SDK preset 与用户配置；插件、明确开启的工作流另见下表。 | 删默认产品段和失效段；保留原生 preset、用户明确设置与真正依赖的按需能力。 | P1、P2、P3、P4 |
| Codex | `agents/codex/index.ts:buildCodexDeveloperInstructions` 顺序为 answer delivery、空 engine append、memory、contacts、roster、runtime system、memory index、userPrompt；thread/start、resume、fork 等复用。当前没有启用代理，走原生 `developerInstructions`。 | 用户输入与 developer 输入会；工具调用/结果会。 | 原生 app-server、用户选择的模型/权限；明确的插件/工作流例外。 | 普通任务取消额外 developerInstructions，继续让 CLI 加载原生说明与 MCP。启动覆盖及线程覆盖分别清理。 | P1、P2、P3、P4 |
| Pi | `agents/pi/index.ts` 将 answer delivery、host+business+pi prompt、roster、memory、userPrompt、extra-dirs 拼成文件，再传 `--append-system-prompt`；还用 `--extension` 加载 cindy bridge、条件 subagent 和 plan-mode。 | 已实测 system、user、工具调用/结果进入 Pi 原生 JSONL；扩展 custom message 也可进入上下文。 | RPC 执行、原生扩展；loom 权限/审批、插件、额外目录等实际扩展点需要单独裁决。 | 删产品提示与重复原生扩展；拆开 UI/审批所需桥和工具增补，不能只删 append 参数就宣称一致。 | P1、P2、P3、P4 |

### 1.2 用户消息增补（三引擎共同发送链）

主要证据：`maker-ipc/makerSendTransaction.ts` 的发送顺序、`register.ts` 的 lazy-resume / steer 路径、`sessionEventPreparation.ts` 的 compact reset。除明确标为“不发文字”外，下表内容通过 user message 进入三个 CLI，CLI 会保存它；显示层的 persistUserMessage 原文并不能阻止原生文件保存 wire。

| 内容 | 现状 / 证据、作用 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| `buildUiLanguageErrorNote` | `maker-ipc/uiLanguageErrorNote.ts` 前置 `[UI language]`，指定失败、受阻、重试报告使用 UI 语言；以 locale 切换/压缩/clear 为重发边界。 | 是，普通 user 输入。 | UI 翻译不依赖模型提示；终端也能按对话语言回答。 | 删发送与去重槽；界面继续用 i18n。 | P1 |
| `mobileClientPromptNote` / `buildClientEnvironmentNote` | 同目录文件前置 `[客户端说明]`，带控制端/宿主设备名与 ID；手机额外要求 HTML 优先单文件和给路径时附摘要。 | 是。 | device-link 传输、文件读取和手机 HTML 本地资源加载均已有代码实现。 | 删默认环境/产物偏好注入；来源仍保留为 UI 元数据。确有跨机器执行上下文的说明另列。 | P1 |
| `wireNoteMemory` | `wireNoteMemory.ts` 是内存去重，不自产生提示；五种槽为 ui-language、client-environment、side-chat、bot-thread、task-delivery，实际普通发送只填前三种；受理后 commit，压缩/clear reset。 | 自身不写；所选文字会写。 | 若保留 side-chat 边界，可避免每轮重复它。bot/task-delivery 槽目前未由普通链路填充。 | 随删除项删对应槽和调用；只保留确有生产者的去重，清掉空槽，避免留空壳。 | P1、P4 |
| `[Session location changed]` | `sessionAgentSwitchHandler.ts:nativeRelocationHandoff` 提醒在另一台电脑恢复后重新使用当前路径/进程句柄，合并进 pending handoff。 | 路径实际触发并发送时会。 | 同引擎跨机器执行的环境变化；本机原生引用另有跨主机限制。 | 普通任务删；同引擎真实迁址若保留，则仅在用户明确操作后的首条携带最小事实。跨引擎 handoff 继续遵循 P5 删除。远程迁址可达范围待确认。 | P4 |
| `[Side chat context]` | `sideChatContext.ts` 要求 fork 继承历史只作参考，回答当前追问，主任务继续，回复不自动回投。发送链只给 taskSource=side-chat 的任务追加。 | 是。 | 已有旁聊/fork 的独立任务边界；直接继承主任务命令会继续执行主任务。 | 留，仅显式旁聊的首条/上下文重建时；这是用户创建独立追问的必要语义。缩为事实和授权边界，保持后续终端可读。 | P4 |
| `[Review result]` | `reviewer/reviewFollowUp.ts` 将独立 reviewer 结论包装为隐藏 user input，要求核对后修复，并指定回复语言。 | 是，隐藏只影响 loom 显示。 | Review 卡片展示无需自动唤醒开发任务；“审查后自动修复”才依赖。 | 默认删隐藏自动修复输入；用户显式选择“修复”时再把结果作为该次明确请求发送。该工作流变更列入待确认。 | P4 |
| `[Goal]` 首轮/续轮 | `goal-host/directive.ts` 包含 objective、澄清/预算约定和 goal_status 裁决协议，controller 每次 `session.send` 创建一条输入。 | 是。 | 仍保留、且 slimming-plan 标为待确认的目标模式，其续跑调度需要裁决。 | 留仅显式目标任务的最小目标/裁决协议；普通任务不添加。是否继续保留该模式待确认。 | P4 |
| `[目标状态]` | `goal-host/inactiveNote.ts` 读旧 goal 状态和上一条回复，要求退出 goal_status 输出与续跑承诺。 | 命中并发送时会。 | 目标工作流退出后的语义收尾；现有查询还依赖旧消息表。 | 随目标裁决统一处理；若保留，用明确退出事件表达一次，取消普通任务每轮探测旧表与自动插入。 | P4 |
| 计划对账 | `maker-ipc/planReconcile.ts` 根据旧顶层未完成计划前置提示，要求继续、修订或清空；最多六项，每项 160 字符。 | 是。 | 计划泡泡能由本地渲染生命周期收口；展示不依赖模型整理旧计划。 | 删额外对账提示与旧表查询，继续展示 CLI 原生计划。 | P1 |
| `[Working directory recovery]` | `workingDirectoryRecovery.ts` 在目录缺失/挂载变化/工作树恢复失败后说明真实临时 cwd、原文件未恢复等事实。 | 是。 | 保留的工作区恢复、worktree 与外接卷处理；模型必须理解实际 cwd 已改变。 | 留，仅用户接受真实目录恢复/替换的首条，内容限实际目录与原文件状态；避免附加泛化工作流规则。 | P4、P8 |
| `[消息来源]`、插件/Agent 转达信封、Orca Lead/Worker/Bridge 消息 | `messageSourceNote.ts`、`orcaInterAgentDispatcher.ts`、`orca-bridge-prompt.ts` 区分本人输入、Agent 转达、用户原话/Agent 补充，携带回报路由。 | 是。 | 插件主动请求与跨 Agent 转达的来源/授权边界；Orca 部分依赖待确认功能。 | 留真实转达的必要来源边界，普通用户输入为空；Orca 段随团队能力裁决，不给每个任务默认添加。 | P3、P4 |
| MCP App 模型上下文 | `mcp-apps/runtime.ts:mcpAppModelContext` 经发送/steer 携带 View 提交的上下文，受理后消费。 | 是。 | 已打开插件/MCP App 的用户交互。 | 留用户实际提交的可见上下文及来源；普通任务为空。 | P3 |
| 用户附件、@资源、用户自定义 prompt、显式命令 | ChatInput 资源选择、prepareSendUserMessage 和三引擎附件适配将用户选择的文件/图片/命令变成 CLI 输入。 | 是。 | 文件引用、图片和用户明确输入本身。 | 留用户要求的内容；审查包装器中额外要求，删除通用产品偏好。不能把这些输入当默认注入一并清空。 | P1、P4 |
| `/learn` 蒸馏输入 | `learn-host/promptBuilder.ts:buildLearnPrompt` 构造 `[/learn]`、Skill 编写规范、目标语言、当前对话/证据、已安装 Skill 清单及可选参考 Skill；controller 直接发送到学习任务，显示 cleanMessage。 | 是，学习任务的 user 输入。 | slimming-plan 中待确认的学习模式；普通对话不依赖。 | 普通任务不注入；如保留显式 /learn，只发送该次用户选择的素材与必要产物契约，去掉无关 Cindy/Hub 流程。 | P4，待确认 |
| 上下文恢复/续跑与 handoff 包装 | `agentHandoff.ts`、`contextOverflowRollover.ts` 可构造恢复摘要、历史来源及待发送输入说明，部分重建路径还带客户端说明。 | 实际执行恢复时会写新原生输入。 | 同引擎恢复、超长上下文故障处理；跨引擎搬运违反 P5。 | 默认交 CLI 原生压缩/恢复；删除跨引擎包装与失效路由。确有原生 API 故障且仍保留的同引擎恢复，列实际触发证据和完整内容后单独确认，避免换个入口重新加回已删 note。 | P1、P4 |
| 辅助模型输入 | `maker-ipc/workingStatus.ts`、`promptPrediction.ts`、reviewer 等发起独立 oneShot / review 工作，具有各自任务说明。Codex oneShot 使用临时 thread。 | 不作为源任务 user 输入；辅助执行自己的持久化由其 CLI 方式决定。 | 工作状态短文、输入预测、独立审查。 | 与主任务上下文分开审计；无入口/已删除能力的辅助调用删。保留的明确审查继续使用独立任务和用户自己的 CLI。 | P4 |

### 1.3 系统段、扩展与能力覆盖

| 内容 | 现状 / 证据、作用 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| `maker-host/host-system-prompt.md` | 三引擎都注入；775 字节，含 “You are Cindy, an open-source AI assistant.”、上游源码地址和调用 cindy_helper 安装更新的指令。当前没有该 helper，也没有 loom 更新器。 | 系统快照/上下文可记录；Pi 已实测。 | 无。 | 删整个注入与失效文件，不换一套 loom 人设。 | P2 |
| `business-ownership-prompt.md` | 992 字节；要求任务/自动化/插件等留在 Cindy，并先发现 cindy_helper。三引擎共有。 | 同上。 | 插件工具的实际路由和权限由代码保证。 | 删。 | P2 |
| `skill-source-precedence-prompt.md` | 1,001 字节；Claude/Codex 给 Cindy Skills 额外优先级，显式选择下游 Skill 也不能覆盖。Pi 没拼此段。 | 同上。 | 用户/项目原生 Skill 加载无需该优先级。 | 删；采用引擎和用户自己的规则。 | P2 |
| `claude-system-prompt.md` | 723 字节；要求所有面向用户的计划使用自然语言并列出不该写的泛化项目。 | 同上。 | 原生计划工具和渲染无需这份写作规范。 | 删。 | P2 |
| `codex-system-prompt.md` | 723 字节；与 Claude 的计划规范相同。 | 同上。 | 无执行依赖。 | 删。 | P2 |
| `pi-system-prompt.md` | 670 字节；推断主要语言，并强制使用 grep/find/ls/read 搜索读取，Bash 留给其他操作。 | 同上。 | Pi 自己已描述其工具。 | 删。 | P2 |
| maker-core 两个 `system-prompt-append.md/.ts` | Claude/Codex 的 md 都为 0 字节，但常量、拼接入口和旧说明保留。 | 现在无内容。 | 无。 | 删空注入段及失效文档/导出，按调用图整块清理。 | P2 |
| `memory/system-prompt.ts/.md` 和 MEMORY 索引 | 规则 3,691 字节，要求只用 cindy_memory，并覆盖原生 memory 途径；三家 adapter 都有条件分支。Desktop 当前未传 makerMemory manager，provider 工厂也无 cindy_memory。 | 当前 Desktop 不触发；触发后会随系统/索引内容记录。 | Maker Memory 已删除；原生 memory 由 CLI 自管。 | 删 Desktop 不可达依赖及失效注入，不新增 manager/stub。其他保留宿主的引用先核对后删。 | P2 |
| contacts enabled/disabled 段 | Claude/Codex `getContactsPromptState` 仍接通；provider 无 cindy_contacts，默认 off 段仍可能劝用户去已不存在入口开启。Pi 没有 contacts 系统段。 | 条件触发时会进入系统快照。 | 联系人设置入口已消失，见 B5。 | 删两个提示、状态回调和功能剩余依赖。 | P2、P9 |
| `ANSWER_DELIVERY_PROMPT` / `richAnswerGuide.ts` | 三引擎默认追加 cindy-ui 组件语法、布局/状态表达式、示例及额度。Renderer 继续支持协议。 | 系统快照可记录，Pi 已实测。 | 富内容渲染能直接消费输出；普通文本、Markdown 不依赖全局组件教学。 | 删全局追加，保留渲染器；用户显式选择组件产物时提供该次格式说明。 | P2 |
| 插件 roster、managed Skills | `ghost.ts:getGhostRosterPrompt` / `buildGhostRosterPrompt` 把可用插件召回表加入三家系统段；`managed-skills.ts` 把已批准插件中的 SKILL.md 加入引擎扫描/启动资源。 | roster 可进入系统快照；Skill 被读取后会进入原生上下文。 | 保留的 Ghost/plugin-protocol 运行与用户明确启用的插件。 | 删普通任务默认 roster/Skills；仅已选择插件的任务挂载其批准资源。选择范围与工具装配统一，不能靠提示强占原生 Skill。 | P3 |
| Orca Lead/Worker 系统段 | `orcaSessionStartOptions.ts:applyOrcaInstructions` 附加到 userPrompt；包含身份、工具路由、自动派活偏好、结束/回报规则。 | 随对应系统/developer 输入记录。 | Orca 在 slimming-plan 中明确“保留并待确认”，不是已完成的 loom 原生协作方案。 | 从普通任务删除；若保留团队模式，只留角色、路由、授权边界与结果协议，删默认偏好派活等指令。 | P3、P4，待确认 |
| Codex 线程配置 | `index.ts:liveThreadApprovalConfig` 除 MCP 外还传 `features.goals=false`、权限/沙箱、目录、task shell env；capability-routing 会隐藏 visualize 等原生插件。部分 provider 专用 web_search/multi_agent 覆盖仍在 core，Desktop 原生路径未提供对应代理路由。 | 不是 user 文本；CLI 可能在 turn_context/配置事件记录生效设置。 | UI 权限选择、只读 review、额外目录；goal 关闭仅为宿主目标模式避免双续跑。 | 删普通任务产品能力屏蔽、无效 provider 策略及无宿主目标时的 goals 覆盖；保留用户明确权限/目录选择对应的官方参数。 | P2、P3、P4 |
| Claude SDK settings / hooks | `flag-settings.ts` 额外清空 apiKeyHelper、commit/PR attribution，并按策略覆盖 Skills/MCP、思考展示等；main 注册图片压缩 Read hook、并发闸门等。 | 生效配置/工具改写可出现在 CLI 请求快照和工具记录；非额外 user 段。 | 差异/文件捕获、用户权限、命令并发是保留功能；清空 apiKeyHelper 与署名没有 loom 业务依赖。 | 删身份/鉴权/署名与产品路由覆盖；保留纯观察 hook 和显式权限、资源设置；默认图片重写影响模型输入，建议取消，附件显式压缩另行保留。 | P2、P3、P5 |
| Pi MCP 代理工具 | cindy bridge 注册 `cindy_mcp_list_tools`、`cindy_mcp_call_tool`，桥接 35 项 MCP；压缩后还插入隐藏 `cindy-mcp-disclosure-state` 消息提醒已发现工具。 | 发现/调用结果会写；custom message 会入上下文。 | 被明确选中的 loom 插件/团队工具。 | 普通任务删；按需启用时保留最小调用桥，删压缩后教学性提醒。用户自己安装的 Pi MCP 保持原样。 | P3 |
| Pi `ask_user_question` | bridge 注册同名额外工具，使用原生 UI RPC 转成 loom 问答卡片。 | 调用与答复会写。 | B7 保留的提问卡片；Pi 原生扩展调用 UI 仍可由传输层承接。 | 待确认：默认删 host 新造的提问工具；若明确保留模型主动卡片能力，列为受限例外，而非声称工具完全一致。 | P3、P4 |
| Pi 内置工具覆盖 | bridge 重新注册 grep/find/ls/bash；find 使用受管 rg；bash 描述增加 300s 默认/1,800s 上限，并拦截 Pi 管理命令。Windows 另覆盖 powershell；设备托管覆盖 read/write/edit/grep/find/ls/bash 并追加 Workspace 段。 | 调用/结果和系统快照会写。 | 远程执行位置、权限/审批、文件浏览相关策略；本机超时/管理拦截不是 CLI 默认。 | 普通本机任务恢复原生工具语义；观察与审批钩子单独保留。远程 Workspace/执行适配只给真实远程任务。 | P3、P5 |
| Pi 管理与视觉工具 | 条件注册 `cindy_pi_command`、别名 `cindy_pi_extension`、`vision`、`vision-locate`。管理工具由 host token 授权；vision 依赖已启用视觉桥配置。 | 注册后调用/结果会写。 | Pi 安装/扩展管理和视觉代理属于 Cindy 宿主能力；用户自己的 Pi 本身可管理扩展和视觉能力。 | 删额外工具及失效代理接线；保留用户原生扩展与用户安装的 Pi，不改其配置。 | P3 |
| Pi `subagent`、plan-mode、extra-dirs | 条件加载 `cindy-subagent-source.ts` 的 subagent 工具及 Pi 分发的 plan-mode 扩展；`piExtraDirsPrompt` 追加参考目录/可写目录规则。 | 调用/结果、系统或扩展消息会写。 | loom 子代理 UI、计划/权限档与目录授权。 | 默认使用用户原生扩展；host subagent/plan-mode 的保留范围待确认。显式目录授权的事实可保留，限制仍由代码执行。 | P3、P4 |
| `codex-native-fallback-prompt.md` | 20,903 字节的旧 Codex 基础提示副本；当前源码搜索没有加载引用。 | 当前不写。 | 无。 | 后续清理死资产；继续由用户 CLI 自带原生提示决定基础行为。 | P2 |

### 1.4 MCP：实际 35 个工具及逐项取舍

现有开发实例 Main PID `64077`，Codex child PID `65048`。对现有 `mcps-http-bridge` 执行只读 tools/list，得到 `cindy_orca=21`、`cindy=10`、`orca_worker_bridge=4`，总计 **35**。三个引擎使用同一 provider 工厂（`mcp-integrations/mcp-providers.ts` 加 worker bridge）；Codex 走 HTTP，Pi 通过 bridge extension 的发现/调用工具，Claude 本机使用 SDK in-process 的这三个 server。Claude SSH 会话由 `maker-host/index.ts` 的 remote-forward 转成 HTTP 白名单注入；Codex SSH 的既有 config 写入路径另见 B2，不能扩大到本机配置。

当前未接入 cindy_helper、cindy_memory、cindy_contacts 或已删除的自定义 MCP 工厂。用户 CLI 自己配置的 MCP 仍属于用户配置，不计入这 35 项，也不删除。

下表“团队”依赖指现有 Orca UI/服务，slimming-plan 已将它列为待确认；它不构成给所有普通任务默认注入的理由。“按需留”表示仅给用户明确使用对应保留功能的任务挂载；普通任务删除该项。工具声明由 CLI 管理，**每项工具的调用与结果都会由对应 CLI 记录**，历史记录保留。

| 工具 | 现状 / 证据、作用 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| cindy_orca.start_team | 建立团队；`cindy-tools/host/orca/server.ts` | 调用/结果：是 | 团队入口 | 普通任务删；团队功能保留与按需装配待确认。 | P3 |
| cindy_orca.create_worker | 建单个跨引擎 Worker | 是 | 团队派活 | 同上。 | P3 |
| cindy_orca.create_workers | 批量建 Worker | 是 | 团队并行派活 | 同上。 | P3 |
| cindy_orca.list_workers | 查团队成员 | 是 | 团队视图/调度 | 同上。 | P3 |
| cindy_orca.switch_focus | 切换协作焦点 | 是 | Orca 分屏 | 同上；侧栏普通导航无需模型工具。 | P3 |
| cindy_orca.send_to_worker | 给 Worker queue/steer 消息 | 是 | 团队通信 | 同上。 | P3 |
| cindy_orca.interrupt_worker | 中断并投递替换任务 | 是 | 团队任务控制 | 同上。 | P3 |
| cindy_orca.get_worker_queue_status | 读取 Worker 队列 | 是 | 团队排队消息 | 同上。 | P3 |
| cindy_orca.update_queued_message | 编辑排队消息 | 是 | 团队队列编辑 | 同上。 | P3 |
| cindy_orca.cancel_queued_message | 取消排队消息 | 是 | 团队队列控制 | 同上。 | P3 |
| cindy_orca.merge_queued_messages | 合并排队消息 | 是 | 团队队列控制 | 同上。 | P3 |
| cindy_orca.steer_queued_message | 把排队项送入正在执行轮次 | 是 | 团队插话 | 同上。 | P3 |
| cindy_orca.move_queued_message | 调整队列顺序 | 是 | 团队队列控制 | 同上。 | P3 |
| cindy_orca.idle_worker | 将 Worker 置空闲 | 是 | 团队生命周期 | 同上。 | P3 |
| cindy_orca.end_team | 结束团队 | 是 | 团队生命周期 | 同上。 | P3 |
| cindy_orca.archive_worker | 归档 Worker | 是 | 团队生命周期 | 同上；归档事实不得恢复由旧 sessions 表支配原生记录。 | P3、P9 |
| cindy_orca.update_worker | 更新 Worker 身份/角色 | 是 | 团队角色展示 | 普通任务删；团队保留待确认。 | P3 |
| cindy_orca.list_available_models | 列出可派活引擎/模型 | 是 | 团队选引擎 | 同上；普通执行直接由 CLI 选模。 | P3 |
| cindy_orca.get_workspace_info | 获取团队/工作区关系 | 是 | 团队拓扑 | 同上；普通 cwd 由 CLI 提供。 | P3 |
| cindy_orca.worker_status | Worker 诊断状态 | 是 | 团队诊断 | 同上；外部原生状态使用 B3 只读派生。 | P3 |
| cindy_orca.read_worker | 读取 Worker 输出 | 是 | 团队诊断/结果读取 | 同上。 | P3 |
| cindy.connect_account | 打开插件支持的受控连接表单；`ghost/mcpServer.ts` | 是 | 插件账号连接，区别于 B7 Cindy 远程登录 | 按需留；保留受控凭据表单和用户确认。 | P3 |
| cindy.ghost_list | 已安装插件召回 | 是 | 插件发现 | 按需留；普通任务取消默认目录注入。 | P3 |
| cindy.ghost_info | 插件能力与 setup 状态 | 是 | 插件使用前检查 | 按需留。 | P3 |
| cindy.ghost_manual | 读取插件手册 | 是 | 已安装插件的使用说明 | 按需留。 | P3 |
| cindy.ghost_call | 调用已批准插件工具 | 是 | Ghost/plugin-protocol 执行 | 按需留；真实授权仍在 host。 | P3 |
| cindy.media | 导入图片/解析受管媒体路径 | 是 | 插件产物进入受管媒体/本地路径 | 按需留；普通原生图片展示无需此工具。 | P3 |
| cindy.ghost_forge_guide | 插件创作指南 | 是 | Agent 插件创作流程，框架运行无需它 | 建议删默认工具；是否保留创作入口待确认。 | P3 |
| cindy.ghost_forge_scaffold | 生成插件脚手架 | 是 | 同上 | 同上，已有插件照常运行。 | P3 |
| cindy.ghost_forge_pack | 打包创作插件 | 是 | 同上 | 同上，GUI 安装/导入保持。 | P3 |
| cindy.ghost_forge_install | 创作插件安装/确认 | 是 | 同上 | 同上；若保留 Agent 创作，按需保留 host 的验证与安装同意。 | P3 |
| orca_worker_bridge.send_to_lead | Worker 回报；`orca-workflow/orca-bridge-mcp.ts` | 是 | 团队异步回报 | 普通任务删；仅已确认 Worker 按需留，团队范围待确认。 | P3 |
| orca_worker_bridge.read_lead_history | 读取 Lead 历史 | 是 | Worker 诊断/背景查询 | 同上；不能借此给普通任务默认搬上下文。 | P3 |
| orca_worker_bridge.read_lead | 读取 Lead 当前输出 | 是 | Worker 诊断 | 同上。 | P3 |
| orca_worker_bridge.lead_status | Lead 状态 | 是 | Worker 生命周期 | 同上。 | P3 |

Claude SDK 的三个 provider 名称与上表相同；SDK 自己从用户配置加载的 MCP、子代理工具仍是原生能力。Pi 这 35 项经两项 cindy_mcp 工具间接暴露，加上上节列出的 Pi 扩展工具，不能把“35”误当 Pi 的总工具数。Codex 的动态提问兼容入口与原生 requestUserInput 由适配器处理；本次 A 段只修其取消收尾。

Claude 还有两种条件来源，不计入本机普通任务实测的 35 项：`buildMcpServers` 在 LOCAL_AGENT_CLIENT 模式接调用方指定的单个 HTTP MCP（缺省名 client，工具由调用方给定），在 device-hosted 模式接 `cindy_exec` 和任务所在电脑明确提供的 MCP 名称。后者在另一台电脑运行模型、文件与命令仍在原工作区执行；不是把本地用户配置复制过去。

| 条件工具 / 输入 | 现状 / 证据、作用 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| cindy_exec.Bash | `remote-agent/executor/executor.ts:toolDefinitions`，在任务所在电脑执行命令 | 调用/结果：是 | 设备托管的远程工作区执行 | 留真实设备托管任务；普通本机任务不挂载。 | P3、P4 |
| cindy_exec.BashOutput | 读取远程后台命令输出 | 是 | 同上 | 同上。 | P3 |
| cindy_exec.KillShell | 结束远程后台命令 | 是 | 同上 | 同上；用户操作权限由原通道控制。 | P3 |
| cindy_exec.Read | 读取实际工作区文件 | 是 | 同上 | 留远程文件读取。 | P3 |
| cindy_exec.Write | 写实际工作区文件 | 是 | 同上 | 留已授权远程写入。 | P3 |
| cindy_exec.Edit | 修改实际工作区文件 | 是 | 同上 | 同上。 | P3 |
| cindy_exec.NotebookEdit | 修改远程 notebook 单元 | 是 | 同上 | 同上。 | P3 |
| cindy_exec.WebFetch | 可选，使用工作区所在电脑网络取网页 | 是 | 设备托管中的明确网络位置 | 条件保留；不在普通任务另加重复 WebFetch。 | P3 |
| deviceHostedEnvironmentNote / Pi Workspace 段 | 说明模型进程与真正文件/命令工作区分离，Claude/Codex/Pi 在各自系统/工具桥中拼入 | 系统快照可记录 | 保留的跨设备执行语义 | 留真实远程任务的 cwd、平台、shell、执行位置事实；普通任务为空。 | P4 |
| LOCAL_AGENT_CLIENT 自有 MCP | 调用方提供 url/token/name/schema；不经过这三个默认 provider | 调用/结果：是 | 本机应用接入明确请求的工具 | 保持显式调用范围，不扩散到普通原生任务；调用方工具随连接实际清单核对，不能预先记成固定 35 项。 | P3 |

### 1.5 Codex 启动参数与 developer instructions

现有 argv 实际为 `codex app-server` 加下面 **12 组 `-c <override>`，合计 24 个 extraArgs 数组元素**。`extraArgsCount=24` 不是 24 个独立覆盖项。bridge 端口为每次启动分配，下面用 `<bridge>` 表示；token 经 `LIZI_MCP_TOKEN` 环境变量传递，argv 只有变量名。

| 参数内容 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| `mcp_servers.cindy_orca.url=<bridge>/mcp/cindy_orca` | `codexEnvironment.ts:doStart` 与现有 argv | argv 不直接写配置；生效工具/调用可记录 | 团队 21 工具 | 普通任务删；团队裁决后按 thread 装配。 | P3 |
| `mcp_servers.cindy_orca.bearer_token_env_var="LIZI_MCP_TOKEN"` | 同上 | 同上；凭据值不进入 argv | 上项鉴权 | 随服务同进退。 | P3 |
| `mcp_servers.cindy_orca.startup_timeout_sec=600` | 同上 | CLI 可记录生效设置 | 上项冷启动 | 随服务同进退。 | P3 |
| `mcp_servers.cindy_orca.tool_timeout_sec=600` | 同上 | 同上 | 上项调用超时 | 随服务同进退。 | P3 |
| `mcp_servers.cindy.url=<bridge>/mcp/cindy` | 同上 | 工具声明由 CLI 管理，调用会写 | 插件/媒体 | 普通任务删；明确插件任务按需留。 | P3 |
| `mcp_servers.cindy.bearer_token_env_var="LIZI_MCP_TOKEN"` | 同上 | 变量名可记录；token 不随本文保存 | 插件桥鉴权 | 随服务同进退。 | P3 |
| `mcp_servers.cindy.startup_timeout_sec=600` | 同上 | CLI 可记录生效设置 | 插件桥冷启动 | 随服务同进退。 | P3 |
| `mcp_servers.cindy.tool_timeout_sec=600` | 同上 | 同上 | 插件调用超时 | 随服务同进退。 | P3 |
| `mcp_servers.orca_worker_bridge.url=<bridge>/mcp/orca_worker_bridge` | 同上 | 调用会写 | Worker 4 工具 | 普通任务删；仅实际 Worker 按需留。 | P3 |
| `mcp_servers.orca_worker_bridge.bearer_token_env_var="LIZI_MCP_TOKEN"` | 同上 | 变量名可记录 | 上项鉴权 | 随服务同进退。 | P3 |
| `mcp_servers.orca_worker_bridge.startup_timeout_sec=600` | 同上 | CLI 可记录生效设置 | 上项冷启动 | 随服务同进退。 | P3 |
| `mcp_servers.orca_worker_bridge.tool_timeout_sec=600` | 同上 | 同上 | 上项超时 | 随服务同进退。 | P3 |

core 还保留条件参数 `--disable plugins/remote_plugin`、`-c sqlite_home=…`，现有被审计子进程没有它们；按真实调用者清理，不能因为源码存在就记成当前 24 项之一。线程级 MCP URL/policy、`features.goals`、权限 profile、额外目录、用户选模及 developerInstructions 发生在 JSON-RPC 层，属于另一条输入面，见 1.1/1.3；只删除 argv 会留下这些差异。

### 1.6 历史显示剥离单独处理

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| `native-sessions/presentation.ts` | `nativeUserDisplayText` 仅从头部逐段移除完全匹配的 UI-language 与新/旧 client note；动态设备段用实际构造器回算匹配。摘要若截在说明中则先给占位，读取历史后在内存恢复首条真实正文。 | 否，纯内存投影；原始历史仍由 CLI 保存。 | B7 已确认的干净正文、标题/预览与终端历史原样保留。 | **留历史显示兼容**。删除发送端 builder 后，把冻结的历史签名内聚到 presentation，避免为显示保留发送模块。用户正文中引用的段落继续显示；不做全局正则替换、不回写历史、不扩大到任意相似文本。 | P1 |
| 历史工具、系统段与用户原话 | 三 CLI 都可已经保存旧增补；模型 resume 是否沿用旧 system 快照由该 CLI 自己决定。 | 已经存在。 | 原生记录完整与终端续接。 | 全部保留；停止未来注入不代表历史上下文被清空。用户要求新基线时新建原生任务；不自动重写、清洗或重放旧会话。 | 全部提交的验收约束 |

## B2. 子进程环境与客户端标识

### 2.1 实际环境的构造与采样边界

本机实际安装版本为 **Claude Code 2.1.316、Codex 0.166.0、Pi 1.4.0**，由各自 package.json 只读取得；architecture 中的 2.1.312 / 0.163.0 是早期调研基线。本轮没有启动这三个 CLI 做新任务。现存 Codex 子进程可以直接采样；当时没有对应的活跃 Claude/Pi CLI，二者以下结论来自真实启动代码和 SDK/原生安装包，不能称为本轮进程实测。

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| 现有 Main / Codex 子进程 | Main PID 64077 的启动环境有 85 个大写变量名，Codex PID 65048 有 96 个；从 ps 的完整结果在内存抽取变量名，未输出凭据值。子进程仍含 CODEX_THREAD_ID、CODEX_SANDBOX_NETWORK_DISABLED=1、CODEX_PERMISSION_PROFILE=:workspace、CODEX_CI=1、CODEX_SHELL=1、CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop。 | 环境自身不写；会影响 CLI 行为、请求 originator/UA，部分效果可进入原生元数据。 | 没有 loom 功能依赖外层任务 ID、沙箱标签或外层工具管道。 | 删外层运行标记。UA 问题既涉及 clientInfo，也涉及继承的 originator override，必须同时修。 | P5 |
| Claude 本机 | `env-builder.ts:cleanProcessEnv` 复制完整 process.env，然后叠加 runtimeConfig.behaviorFlags；`index.ts` 再补本任务 askpass。当前 host 的 behaviorFlags 仅工具链限核。SDK 自己负责所属 CLI 的启动标记。 | 环境不直接持久化；工具执行与请求快照会反映效果。 | 用户登录/配置、PATH、明确资源设置、代输入。 | 在最早的共享 env 边界清掉外层标记，再让 SDK 生成自己的运行值；保留用户配置变量。 | P5 |
| Codex 本机 | `buildCodexEnv` 全量继承，叠加工具链限核、rg/平台 PATH、Python UTF-8 默认值、纯文本终端默认值，合并 NO_PROXY/no_proxy 的 localhost；`prepareCodexExtraSpawnConfig` 加 LIZI_MCP_TOKEN。原生 launcher 可再加自己的 CODEX_MANAGED_BY_NPM、CODEX_MANAGED_PACKAGE_ROOT。 | 同上；clientInfo/source/originator 可入 session_meta。 | 原生执行、编码、选用的插件桥；限核是设置。 | 先净化外层标记，再加所属 CLI/本任务值。删除 MCP 时同时删仅为该桥所加的 token 与 localhost 改写；编码/PATH 按实际需要保留。 | P3、P5 |
| Pi 本机 | `index.ts:spawnEnv` 全量继承，再加限核、taskShellEnv、mcpEnv、CINDY_PI_SECRET_ENV_NAMES、CINDY_PI_SESSION_ID、CINDY_PI_PERMISSION_FILE、CINDY_PI_TURN_TOOL_POLICY、PI_OFFLINE=1、CINDY_LOCAL_HOST_TOOLS_ONLY；按条件加 package token、managed rg、MCP_BRIDGE、review-only、hosted 和子代理运行文件等。 | 环境不直接成为消息；扩展产出的工具/系统/自定义消息会写。 | 本地 RPC、审批、按需插件、资源管理；一部分仍是 Cindy 遗留。 | 同样先净化外层标记；每个 CINDY_* 随实际保留能力同进退，禁止整个对象无条件保留。PI_OFFLINE 只控制版本检查/遥测，是否保持需与用户原生偏好一致。 | P3、P5 |
| SSH 三引擎 | Claude remoteEnv 与 Pi remote spawn 从空对象起，远端 manager 合并远端用户环境；Codex 本地 env/extraArgs 在远程 transport 下不参与。Pi 可另传显式 SSH 转发代理。 | 本地环境不因此写远端记录；远端实际配置决定原生行为。 | 保留的 SSH 与远程执行。 | 保持本地运行标记不跨 SSH；对远端 manager 自身的父环境使用相同净化规则。用户明确代理继续保留。 | P5 |
| SSH Codex MCP 配置路径（实施时复核修正） | `remote-ssh/codex-remote-mcp.ts` 实际只建立 SSH forward、保存 loom 端口/指纹元数据，并构造会话级 RPC 配置。旧注释误写 config.toml 读写，调查初版据此误判。 | 不写 CLI 配置；生效 MCP 调用会进入原生记录。 | 明确工作流的远程 host 工具桥。 | 保持会话级配置，按角色缩小服务集合；纠正旧注释。 | P3 |
| 工具链限核 | `toolchain-thread-cap.ts` 在用户未设置时补 VITEST_MAX_FORKS、VITEST_MAX_THREADS、CARGO_BUILD_JOBS，非 Windows 加 MAKEFLAGS；由设置控制。 | 否；模型工具命令环境会受影响。 | 已有资源设置。 | 留显式开启的资源设置；默认尽量继承用户。它不属于外层 Agent 运行标记。 | P5 |
| 本任务 askpass | `input-handoff/askpass/host.ts:envFor` 按本任务生成 CINDY_INPUT_HANDOFF_ROUTE、SUDO_ASKPASS、SSH_ASKPASS、SSH_ASKPASS_REQUIRE=force、GIT_ASKPASS；尊重用户已有 helper。Codex 通过 shell_environment_policy.set 按 thread 下发，避免共享 app-server 串任务。 | 环境本身不写；后续命令仍正常记录。 | 保留的用户代输入与受控凭据表单。 | 留本任务重新生成的值，先去掉外层继承的路由/helper；用户自己配置的 helper 保留。 | P5 |

Codex 子进程相对 Main 启动快照新增的变量名为：CLAUDE_AGENT_SDK_VERSION、CLICOLOR、CODEX_MANAGED_BY_NPM、CODEX_MANAGED_PACKAGE_ROOT、FORCE_COLOR、LIZI_MCP_TOKEN、PYTHONIOENCODING、PYTHONUTF8、XDT_CC_DEBUG_FILE、XDT_DEVICE_ID_OVERRIDE、XDT_USER_DATA_DIR。Main 的 process.env 可在启动后变化；这份差集表示实际两个进程快照差异，不能把全部差集都归因于 buildCodexEnv。特别是 CLAUDE_AGENT_SDK_VERSION 进入 Codex 说明跨引擎运行标记也需要隔离。


完整变量名补采（2026-11-02 15:57:02 +08）：Main **112** 个，现有 Codex **124** 个，包含大小写与 npm 变量。下面只保存名称；Claude/Pi 未运行的条件增量以上节源码清单为准。

| 采样集合 | 现状 / 证据：变量名 | 是否写原生文件 | 依赖它的保留功能 | 建议 | 拟拆提交 |
| --- | --- | --- | --- | --- | --- |
| Main 启动快照（112 个，作为源快照；实际 process.env 可在运行期变化） | `ALL_PROXY`, `AUTOJUMP_ERROR_PATH`, `AUTOJUMP_SOURCED`, `BROWSER_USE_ACCESS_EXECUTOR_ID`, `BROWSER_USE_ACCESS_PIPE_PATH`, `BROWSER_USE_ACCESS_VERIFYING_IDENTITY`, `CINDY_AUTH_REGION`, `CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS`, `CODEX_APP_RUNTIME_CLI_PATH`, `CODEX_APP_TOOLS_PIPE_PATH`, `CODEX_CI`, `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, `CODEX_MCP_NODE_PATH`, `CODEX_PERMISSION_PROFILE`, `CODEX_SAGE_BACKFILL_TRACKER_TAB_REUSE`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_SESSION_ID`, `CODEX_SHELL`, `CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY`, `CODEX_TECTONIC_PATH`, `CODEX_THREAD_ID`, `CODEX_TOOL_CALL_ID`, `CODEX_VERSION`, `COLORTERM`, `COMMAND_MODE`, `COREPACK_ENABLE_DOWNLOAD_PROMPT`, `COREPACK_ROOT`, `DEVECO_HOME`, `DEVECO_SDK_HOME`, `DISABLE_AUTO_UPDATE`, `GH_PAGER`, `GIT_PAGER`, `GOPATH`, `HOME`, `HOMEBREW_NO_ENV_HINTS`, `HTTPS_PROXY`, `HTTP_PROXY`, `INIT_CWD`, `LANG`, `LC_ALL`, `LC_CTYPE`, `LESS`, `LOGNAME`, `LOG_FORMAT`, `LSCOLORS`, `LS_COLORS`, `MallocNanoZone`, `NODE`, `NODE_ENV`, `NODE_OPTIONS`, `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S`, `NO_COLOR`, `NO_PROXY`, `NVM_BIN`, `NVM_CD_FLAGS`, `NVM_DIR`, `NVM_INC`, `OSLogRateLimit`, `PACKY_API_KEY`, `PAGER`, `PATH`, `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT`, `PNPM_HOME`, `PNPM_SCRIPT_SRC_DIR`, `PWD`, `PYENV_ROOT`, `PYENV_SHELL`, `RUSTUP_DIST_SERVER`, `RUSTUP_UPDATE_ROOT`, `RUST_LOG`, `SHELL`, `SHLVL`, `SSH_AUTH_SOCK`, `TERM`, `TMPDIR`, `USER`, `VIRTUAL_ENV_DISABLE_PROMPT`, `VITE_CINDY_AUTH_REGION`, `VITE_CJS_IGNORE_WARNING`, `XDT_DESKTOP_DEV_MODE`, `XPC_FLAGS`, `XPC_SERVICE_NAME`, `ZSH`, `ZSH_TMUX_AUTOSTART`, `ZSH_TMUX_AUTOSTARTED`, `_`, `__CF_USER_TEXT_ENCODING`, `all_proxy`, `http_proxy`, `https_proxy`, `no_proxy`, `npm_command`, `npm_config__jsr_registry`, `npm_config_engine_strict`, `npm_config_frozen_lockfile`, `npm_config_globalconfig`, `npm_config_node_gyp`, `npm_config_node_linker`, `npm_config_npm_globalconfig`, `npm_config_recursive`, `npm_config_registry`, `npm_config_update_notifier`, `npm_config_user_agent`, `npm_config_verify_deps_before_run`, `npm_execpath`, `npm_lifecycle_event`, `npm_lifecycle_script`, `npm_node_execpath`, `npm_package_json`, `npm_package_name`, `npm_package_version`, `pnpm_config_verify_deps_before_run` | 环境本身不写；生效行为可记录 | 按变量分类，见上表 | 分类净化，保留用户配置；不按整份名单全保留 | P5 |
| Codex 继承交集（111 个） | `ALL_PROXY`, `AUTOJUMP_ERROR_PATH`, `AUTOJUMP_SOURCED`, `BROWSER_USE_ACCESS_EXECUTOR_ID`, `BROWSER_USE_ACCESS_PIPE_PATH`, `BROWSER_USE_ACCESS_VERIFYING_IDENTITY`, `CINDY_AUTH_REGION`, `CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS`, `CODEX_APP_RUNTIME_CLI_PATH`, `CODEX_APP_TOOLS_PIPE_PATH`, `CODEX_CI`, `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, `CODEX_MCP_NODE_PATH`, `CODEX_PERMISSION_PROFILE`, `CODEX_SAGE_BACKFILL_TRACKER_TAB_REUSE`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_SESSION_ID`, `CODEX_SHELL`, `CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY`, `CODEX_TECTONIC_PATH`, `CODEX_THREAD_ID`, `CODEX_TOOL_CALL_ID`, `CODEX_VERSION`, `COLORTERM`, `COMMAND_MODE`, `COREPACK_ENABLE_DOWNLOAD_PROMPT`, `COREPACK_ROOT`, `DEVECO_HOME`, `DEVECO_SDK_HOME`, `DISABLE_AUTO_UPDATE`, `GH_PAGER`, `GIT_PAGER`, `GOPATH`, `HOME`, `HOMEBREW_NO_ENV_HINTS`, `HTTPS_PROXY`, `HTTP_PROXY`, `INIT_CWD`, `LANG`, `LC_ALL`, `LC_CTYPE`, `LESS`, `LOGNAME`, `LOG_FORMAT`, `LSCOLORS`, `LS_COLORS`, `MallocNanoZone`, `NODE`, `NODE_ENV`, `NODE_OPTIONS`, `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S`, `NO_COLOR`, `NO_PROXY`, `NVM_BIN`, `NVM_CD_FLAGS`, `NVM_DIR`, `NVM_INC`, `OSLogRateLimit`, `PACKY_API_KEY`, `PAGER`, `PATH`, `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT`, `PNPM_HOME`, `PNPM_SCRIPT_SRC_DIR`, `PWD`, `PYENV_ROOT`, `PYENV_SHELL`, `RUSTUP_DIST_SERVER`, `RUSTUP_UPDATE_ROOT`, `RUST_LOG`, `SHELL`, `SHLVL`, `SSH_AUTH_SOCK`, `TERM`, `TMPDIR`, `USER`, `VIRTUAL_ENV_DISABLE_PROMPT`, `VITE_CINDY_AUTH_REGION`, `VITE_CJS_IGNORE_WARNING`, `XDT_DESKTOP_DEV_MODE`, `XPC_FLAGS`, `XPC_SERVICE_NAME`, `ZSH`, `ZSH_TMUX_AUTOSTART`, `ZSH_TMUX_AUTOSTARTED`, `_`, `__CF_USER_TEXT_ENCODING`, `all_proxy`, `http_proxy`, `https_proxy`, `npm_command`, `npm_config__jsr_registry`, `npm_config_engine_strict`, `npm_config_frozen_lockfile`, `npm_config_globalconfig`, `npm_config_node_gyp`, `npm_config_node_linker`, `npm_config_npm_globalconfig`, `npm_config_recursive`, `npm_config_registry`, `npm_config_update_notifier`, `npm_config_user_agent`, `npm_config_verify_deps_before_run`, `npm_execpath`, `npm_lifecycle_event`, `npm_lifecycle_script`, `npm_node_execpath`, `npm_package_json`, `npm_package_name`, `npm_package_version`, `pnpm_config_verify_deps_before_run` | 环境本身不写；生效行为可记录 | 按变量分类，见上表 | 分类净化，保留用户配置；不按整份名单全保留 | P5 |
| Codex 新增（13 个） | `CLAUDE_AGENT_SDK_VERSION`, `CLICOLOR`, `CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_PACKAGE_ROOT`, `FORCE_COLOR`, `LIZI_MCP_TOKEN`, `NoDefaultCurrentDirectoryInExePath`, `PSStyle__OutputRendering`, `PYTHONIOENCODING`, `PYTHONUTF8`, `XDT_CC_DEBUG_FILE`, `XDT_DEVICE_ID_OVERRIDE`, `XDT_USER_DATA_DIR` | 环境本身不写；生效行为可记录 | 按变量分类，见上表 | 分类净化，保留用户配置；不按整份名单全保留 | P5 |
| Codex 删除（1 个） | `no_proxy` | 环境本身不写；生效行为可记录 | 按变量分类，见上表 | 分类净化，保留用户配置；不按整份名单全保留 | P5 |

### 2.2 剔除与保留规则

不能按 `CODEX_*`、`CLAUDE_CODE_*` 前缀全删：同一命名空间包含用户配置和本次 CLI 自己生成的值。实现采用共享的“清理已知父任务标记 → 引擎/本任务装配”入口，并让三家本地及远端 launcher 使用同一判据。只记录被移除的变量名。

| 类别与具体名称 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| Codex 父任务 ID/权限 | 本轮实测 CODEX_THREAD_ID、CODEX_SESSION_ID、CODEX_TOOL_CALL_ID、CODEX_SANDBOX_NETWORK_DISABLED、CODEX_PERMISSION_PROFILE、CODEX_CI、CODEX_SHELL | 值可能间接影响环境/记录 | 无 | 剔除继承值。新 CLI 自己设置的标记属于它自身。 | P5 |
| Codex 父客户端与工具管道 | 实测 CODEX_INTERNAL_ORIGINATOR_OVERRIDE、CODEX_APP_RUNTIME_CLI_PATH、CODEX_APP_TOOLS_PIPE_PATH、CODEX_MCP_NODE_PATH、CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY、CODEX_SAGE_BACKFILL_TRACKER_TAB_REUSE、CODEX_TECTONIC_PATH、CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS、CODEX_VERSION | originator/UA 可能记录 | 无 | 剔除外层值；launcher 的 CODEX_MANAGED_BY_NPM/PACKAGE_ROOT 按本次 CLI 正常重新生成。 | P5 |
| Claude 父运行标记 | CLAUDECODE、CLAUDE_CODE_ENTRYPOINT、CLAUDE_CODE_SESSION_ID、CLAUDE_CODE_PARENT_SESSION_ID、CLAUDE_AGENT_SDK_VERSION 等；当前 Codex 已实测混入 SDK_VERSION | 可能进入请求元数据 | 无 | 只清已核实的运行类名称；由本次 SDK/CLI 重新生成所属标记。补齐当前安装版实际使用名称后落地。 | P5 |
| 其他宿主运行通道 | 实测 BROWSER_USE_ACCESS_EXECUTOR_ID、BROWSER_USE_ACCESS_PIPE_PATH、BROWSER_USE_ACCESS_VERIFYING_IDENTITY、NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S；PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT 需核对是否来自外层 runner | 不直接写；可改变工具访问范围 | 无默认依赖 | 清已知父进程管道/身份。Pi package-root 值来源仍列待确认，按真实启动场景测试。 | P5 |
| 旧 loom/Cindy 路由与调试变量 | 父进程可能携带 CINDY_INPUT_HANDOFF_ROUTE、CINDY_PI_*、LIZI_MCP_TOKEN、XDT_CC_DEBUG_FILE，以及 Electron/Node 开发启动标记 | 通道/工具行为可能记录 | 仅本次 host 生成的值有效 | 清旧运行路由后重建；NODE_OPTIONS、ELECTRON_RUN_AS_NODE 等按实际 launcher 需求处理，不能把开发 inspect 参数带给用户 CLI，也不能抹掉 launcher 必需值。 | P5 |
| 用户配置根目录 | CODEX_HOME、CLAUDE_CONFIG_DIR、PI_CODING_AGENT_DIR、PI_CODING_AGENT_SESSION_DIR | CLI 仍在用户指定目录保存记录 | 原生会话事实源 | 原样保留。 | P5、P6 |
| 用户模型/认证设置 | OPENAI_*、ANTHROPIC_*、用户明确的 CODEX/CLAUDE_CODE 模型、输出、memory、权限配置变量；例 ENABLE_TOOL_SEARCH、CLAUDE_CODE_MAX_OUTPUT_TOKENS | CLI 自行消费 | 用户自己安装 CLI 的完整配置 | 保留，禁止因宽泛前缀规则覆盖；不读取/复制登录文件中的凭据。 | P5 |
| 代理与系统/工具环境 | HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、NO_PROXY 及小写变体、PATH、HOME、SHELL、LANG/LC_*、SSH_AUTH_SOCK、用户开发工具变量 | CLI 自行消费 | 用户网络与开发环境 | 原样保留用户选择；loopback 例外只随真实保留桥存在。 | P5 |

当前进程采样不能枚举尚未运行的所有未来条件变量。落地测试必须从人工构造的父环境验证以上清理规则，再比较三家实际子进程；本次第 0 步保持既有 CLI 会话只读。

### 2.3 Codex clientInfo 改名与列表过滤核实

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| clientInfo | `codex/index.ts` 写死 `{name:'cindy',version:'0.0.0'}`；旁边“只影响展示、与 originator 无关”的注释与当前 CLI 源码不符。[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server#initialization) 说明 clientInfo 标识客户端。 | originator 可入 session_meta；UA 随 initialize 建立。 | 正确客户端归属和诊断。 | 改为 name=loom，version 由 Desktop 的 `app.getVersion()` 经既有 host/runtime 配置注入 core；core 不反向 import desktop package。 | P5 |
| 当前 CLI source | 已安装 0.166.0；公开对应 tag 的 [app-server/src/lib.rs](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server/src/lib.rs) 的 stdio `run_main` 固定使用 `SessionSource::VSCode`，clientInfo 不控制这个 source。[initialize_processor.rs](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server/src/request_processors/initialize_processor.rs) 则用 name 设置 originator，并兼容 env 已先设置的情况。 | source/originator 均可能记录。 | 原生任务可发现性。 | 确认 cindy→loom 不改变当前 stdio 的 source；先清父 originator override，令真实 loom 身份生效。保留正确 source，禁止伪装 Codex Desktop。 | P5 |
| `codex resume` 列表 | 0.166.0 [tui/src/lib.rs](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/tui/src/lib.rs) 的 resume_source_kinds 默认 cli/vscode，带 include-non-interactive 才加 exec/appServer；[resume_picker.rs](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/tui/src/resume_picker.rs) 发 `originators:None`。按 UUID 续接走 thread/read。 | 读取不写。 | 终端列表和直接续接。 | 当前 source=vscode 仍在默认列表，不因 name=loom 消失；cwd/model-provider 的既有筛选保持。 | P5 |
| 本机 Codex app 列表 | 实际宿主 App 26.1023.51421（22530）；只读检查 app.asar 中 main-UOTY8NmV.js 与 src-D0VLwrLy.js：本机 hostId=local 的 readThreadListOriginators 返回 undefined；仅 hostId=durable 返回 codex_cloud/codex_work_cca。sourceKinds 常量为 []，交给 app-server 的交互 source 默认；post-filter 排除 ephemeral/ambient_suggestions，未按本机 originator 删条目。 | 读取不写。 | Codex app 本机任务列表。 | 当前本机列表不会因 originator=loom 被过滤。durable/cloud 的过滤是另一种 host，不据此伪造本机身份。 | P5 |
| 核实边界 | 上述是实际安装包、对应 CLI 版本的源码审查；没有为实验创建 originator=loom 的新任务。 | 本次零新建/续跑。 | 用户的只读约束。 | 代码层结论已成立。实施时若 CLI/App 升级，重新核对相同过滤点；运行验收使用用户批准的正常任务，继续只经官方 CLI。 | P5 |

## B3. 外部任务实时更新、状态与未读

### 3.1 当前行为与路径解析

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| 扫描触发 | `native-sessions/index.ts:refreshNativeSessions` 只有 startup/project/turn/focus/manual；focus 在 lastScannedAt 后 5 分钟内跳过。`NativeSessionIndexer` 以整个引擎的目录 size+mtime 签名决定是否重新列举。 | 否 | 原生侧栏索引 | 加只读事件源，保留这些主动对账触发；焦点刷新不再成为实时性的主要来源。 | P6 |
| 当前打开的历史 | `makerChatStore.ts` 已处理 `native-sessions:changed`，会 reload 已打开且本地未跑的原生历史；主机当前没有持续 watcher 发这个事件，所以外部更新仍等到扫描。它还会对所有打开任务做刷新。 | 否 | 原生历史现读 | 复用现有事件和 reloadMessages；payload 加精确 changed UI IDs/签名，只刷新受影响已打开任务。外部 running 与本地 live overlay 判据分开，避免新增外部状态后被现有 `!isRunning` 条件阻挡。 | P6、P7 |
| Claude 根 | `$CLAUDE_CONFIG_DIR/projects`，缺省 `~/.claude/projects`；当前 lister 枚举项目 UUID 文件，SDK listSessions/getSessionInfo 取语义。 | 否 | 用户重定向配置与官方读取 | 监听实际根目录；忽略 subagents，项目/文件新增触发目标引擎发现。不要反算长路径目录编码。 | P6 |
| Codex 根 | `$CODEX_HOME/sessions`、`archived_sessions`、`session_index.jsonl`；默认 ~/.codex。当前 lister 已显式列 cli/vscode/exec/appServer/unknown，排除 subagent/review/compact。 | 否 | 终端、IDE、Codex app 列表/改名/归档发现 | 监听三条来源；继续用官方 source 元数据排除所有 Codex subagent，不按 originator 筛掉第三方 GUI。 | P6 |
| Pi 根 | 当前 lister signature 只看 PI_CODING_AGENT_SESSION_DIR 或 agentDir/sessions，实际 `SessionManager.listAll()` 却未带覆盖目录；已安装 main.js 的真实优先级为 CLI `--session-dir` → PI_CODING_AGENT_SESSION_DIR → SettingsManager.getSessionDir() → 默认 getSessionsDir()。 | 否；只读接口注意下行 | Pi 重定向目录、原生列表 | 把 lister、signature、watcher、官方 listAll 的根统一为同一解析结果；设置只读取 sessionDir，不改写。独立终端的 --session-dir 若不在已知根，通过已有原生引用/用户选定根加入；无法全盘推断任意目录，列待确认。 | P6 |
| Pi 工作区设置 | sessionDir 来自 CLI 启动时合并的设置，工作区 `.pi/settings.json` 可与全局设置不同。 | 否 | 每个工作区实际的原生目录 | 按已知项目逐个解析有效设置并去重根，使用只读解析或经核实的只读官方接口；不借创建 SettingsManager 改写/初始化用户目录。覆盖多个项目使用不同根的验证。 | P6 |
| Pi 符号链接 | 本机存在会话目录的链接目标；`files.ts:sourceSignature` 已 realpath 去重。 | 否 | 现有 Pi 用户扩展/目录布局 | 对已知链接目标的实际父目录订阅，路径与 realpath 双向映射；链接换目标时重新装配订阅并释放旧订阅。 | P6 |
| 官方读取与只读 | Claude 继续 SDK；Codex 继续 thread/list/read/items/list，禁止 resume 作为刷新；Pi 继续读取临时副本后 SessionManager.open，以隔离该 API 的 migration/修尾写入。 | 原文件不写；临时副本可被官方 reader 整理 | D8 官方语义读取、原生记录完整 | 保持；状态尾读作为用户本次要求的狭窄例外写入 architecture，正文/分支/工具结果继续官方读取。 | P6 |

### 3.2 只读 watcher 与增量投影

使用已有 `@parcel/watcher@2.5.6`，已核对安装包 README 与[官方源码类型说明](https://github.com/parcel-bundler/parcel/blob/v2/flow-libs/parcel-watcher.js.flow)：subscribe 递归监听 create/update/delete，返回可异步 unsubscribe 的订阅；native 层会合并事件。macOS 默认 FSEvents。loom 仍需要应用级防抖和 dirty 集合；重命名是删除+新建事件。

| 设计点 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| 订阅生命周期 | 目前没有原生目录订阅。 | 否 | 实时发现 | 每个规范化根一个 subscription；启动索引就绪后订阅，退出/配置根变化时 unsubscribe。不存在的根监听最近存在的配置父目录，以发现后来创建；只在该受控目录范围内。 | P6 |
| 事件合并 | 每次当前扫描会重新计算整个引擎签名。 | 否 | 低 CPU / I/O | 同文件 150ms 防抖，持续写入最多等 500ms 就提交一批；dirty paths 按引擎合并，进行中的读取再积累下一批，禁止重叠扫描同一来源。 | P6 |
| 增量判据 | 现有 NativeSessionRecord 已有 sizeBytes、mtimeMs、filePath。 | 否；只更新派生索引 | 可删可重建索引 | 用 path+size+mtime 判断；缓存 inode/realpath 识别替换、归档搬移、截断和 zst 替换。签名不变不读；变化只重取该记录语义。现有九列保持，运行态/dirty/read offset 缓存在内存。 | P6 |
| 新文件与目录变化 | 当前官方 lister 能发现记录，但只按项目范围保留。 | 否 | 新任务和 B4 对话发现 | 新文件批量触发所属引擎官方发现；已有 path/ref 用 SDK getSessionInfo、Codex thread/read 等定位更新；Pi listAll 使用统一的实际根。目录删除先核对根/挂载可用性，避免把临时离线当成用户删除。 | P6、P8 |
| 原生消息读取 | 当前已基于官方接口转换成共享 Message。 | 否；消息仅驻内存 | 历史/实时一致、B7 UI UUID | 复用官方转译和 UI UUID 绑定；变更索引后广播 changedIds/revision，当前可见历史优先刷新，隐藏任务只更新摘要和活动。移动/归档保持同一 native ref/UI ID。 | P6 |
| 漏事件对账 | 现有焦点有 5 分钟限流。 | 否 | 唤醒、断卷和 watcher 错误恢复 | 保留启动、睡眠唤醒、焦点对账；每 5 分钟低频只比较签名，错误后有界重订阅并给出可见失败。索引失败保留该引擎旧数据。 | P6 |
| 性能与权限边界 | 全量原生遍历会读很多 metadata；无需额外监控系统目录。 | 否 | 本地优先和空闲节能 | 只订阅实际会话根及明确链接目标，忽略无关 sidecar；不监听整个 HOME，不注册常驻外部任务，不启动 CLI turn，watcher 不产生 native writer。 | P6 |

### 3.3 文件尾状态规则

本轮只读抽查三个引擎各 4 个最近文件的末尾 64 KiB：Claude 出现 `system/turn_duration`，Codex 出现 task_started/task_complete，Pi assistant 的 stopReason 出现 `toolUse`、`stop`。有些 Codex 长轮次的 64 KiB 尾部没有边界，Claude 也可能只有 informational；**没有找到结束标记不能直接等同于运行中**。状态是只读活动估计，不代表 loom 持有进程或审批权。

| 状态项 | 现状 / 证据与判定 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| 有界尾读 | 目前未做外部状态折叠。 | 否 | 低开销实时活动 | 首次从末尾 64 KiB 分块反向找最近边界，最多读取 1 MiB；后续只读追加部分，保留跨块半行直到完整换行。截断/替换时重新建立状态；超大单行/边界不在窗口时标 unknown，不读全文来推断忙碌。是否把首次上限提高另由测量决定。 | P7 |
| Codex | task_started 表示开启轮次，task_complete 表示结束；turn_aborted/明确失败终态同样结束。按 turn_id/时间顺序折叠，旧轮完成不能清掉新轮。 | 否 | 外部 Codex 活动 | 最新有效开始且没有对应结束、最近写入未过期才显示进行中；仅 token_count 或其他更新不把已结束轮次重新标为运行。 | P7 |
| Claude Code | system/turn_duration 表示对应轮次已结束；后续新的用户/assistant/tool 记录可开启下一段活动。away_summary、ai-title 等不是新执行。 | 否 | 外部 Claude 活动 | 比较边界之后的真实对话/工具活动；已结束之后的纯摘要/标题写入只更新未读，不显示运行。首次边界未知时保留 unknown。 | P7 |
| Pi | 最后 assistant 的 stopReason=toolUse 表示工具链未收尾；stop/error/aborted 等当前版本终态结束。更晚的 user/toolResult 需要结合当前分支顺序；用户输入之后尚无 assistant 时可据新写入显示活动。 | 否 | 外部 Pi 活动 | 只在活动分支使用尾记录；分支/压缩使尾片段不足以确定时由官方 reader 确认分支，仍不解析正文。未知 stopReason 显示 unknown。 | P7 |
| 无写入过期 | 长命令/模型请求可能持续一段时间不写文件；文件系统无法证明进程存活。 | 否 | 避免任务永久转圈 | 建议 **5 分钟**无写入就撤下“进行中”，显示最近活动/外部来源；以后新写入再计算。按最近截止时间安排一个 timer，避免每秒轮询所有会话。不是断言 CLI 已结束或已释放锁。 | P7 |
| 等待与审批 | 外部 CLI 的问答/审批通道属于原客户端。 | 否 | B7 外部待答问题只读边界 | 外部任务只有进行中/空闲/未知和未读，不展示“等待操作”按钮；不代选答案，不通过日志反推可审批请求。 | P7 |
| 写入权 | running 的过期只改变显示估计。 | 否 | 单写入者 P4 | 超时不授予 loom 接管权；发送仍独立执行已有原生 writer/锁检查。已有 writer 检测的实现缺口单列，不能用尾部状态替代排他判断。 | P7 |
| 归档与运行分离 | 当前 Session.status=active/archived 是列表/归档语义，原生投影没有独立外部活动。 | 否 | 侧栏筛选、归档、目标/队列 | 新增明确的只读 externalActivity 字段，保持 active/archived 语义；loom 自己持有的 turn 继续用 live 状态，不被文件尾投影覆盖。 | P7 |

### 3.4 未读、侧栏、agent-island 与测量

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| lastViewedAt | `NativeUiState` v2 只有 ref/preferences/draft，当前没有原生未读水位。 | 否，只写 loom 的 native-ui.json | 原生任务未读 | 给 UI entry 加 lastViewedAt；文件 mtime 比水位新即未读。第一次发现已有历史默认未读，打开且实际提交该版本历史后记录已消费版本的 mtime 水位。隐藏窗口/只加载列表不标已读。 | P7 |
| 读取/写入竞态 | 读取期间外部可能又追加。 | 否 | 当前打开任务的可靠未读 | 水位取已成功显示的文件版本，不能简单在点击/加载结束时写 Date.now()，否则会把尚未显示的新写入标为已读。后续版本继续刷新。 | P7 |
| 外部来源 | 当前 originator 可能被父进程污染；文件状态不能证明启动者是哪款客户端。 | 否 | 真实来源展示 | 无本地受控 turn 持有且由原生文件发现的活动统一标“外部”，不要根据 UA 或文件名推断是哪款 App；引擎图标照常显示。 | P7 |
| 侧栏 | 已有状态槽、native-sessions:changed 与 UUID 绑定。 | 否 | 运行、未读与过滤展示 | 复用状态槽显示“外部 · 进行中”和未读点；超时/完成清 spinner；活动与未读独立。明确显示为外部只读来源。 | P7 |
| agent-island | `agent-island/state.ts`、service 和 SessionActivityRelay 主要消费受控 Session/既有活动；relay 默认 1,500ms 节流。 | 否 | 菜单栏/灵动岛列表 | 合并同一 UI UUID 的原生活动与未读；外部只读条目保留来源与打开动作，去掉审批/中断/接管操作。不要为运行/未读分别造第二套状态库。远程复用 existing activity payload，并明确新增字段。 | P7 |
| 空闲 CPU/唤醒 | 本轮未增加 watcher，尚无改后数据。 | 否 | 节能验收 | 同一 profile、同样 CLI/文件集，冷索引完成后分别前台和后台静置 10 分钟，各做 3 次；用 Instruments System Trace/Time Profiler 或等效进程采样记录 Main、worker、reader 子进程的 CPU 时间、平均/峰值 CPU、每秒 wakeups、扫描与官方 API 调用次数。对照现有版本。目标：空闲平均 CPU <1% 单核、增量 <0.5 百分点，额外平均唤醒 ≤1 次/秒，静置期间没有周期性启动任务 CLI。 | P6、P7 |
| 写入到 UI 延迟 | 现状受扫描触发/5 分钟限流影响。 | 否 | 实时性验收 | 从真实 CLI 写入事件/观测 mtime 到 DOM commit、agent-island 快照提交打同一 monotonic clock 标记。每引擎至少 50 次，覆盖新建、普通流式、完成、改名、归档、当前打开/隐藏。报告 p50/p95/p99，目标本机前台 p95≤1s、p99≤2s；远程 relay 的 1,500ms 节流单独报告，不能混为本机延迟。 | P6、P7 |
| 压力/恢复矩阵 | 原生存在大文件、链接、压缩和磁盘变化。 | 否 | 数据完整/无丢更新 | 额外测 1,000+ 文件、100 次/秒写事件、长轮次无尾边界、链接换目标、截断、zst 替换、根目录短暂离线、睡眠唤醒、跨引擎并发、当前页切换与清索引重建。验证 watcher 零写入、配置 hash 保持、历史内容原样、相同 native ref 去重、Codex subagent 0 条进入主列表。CLI 的正常追加另作预期，不要求正在写入的会话整文件 hash 相等。 | P6、P7 |

测量使用用户批准的真实 CLI 操作或独立测试 fixture，loom 只观察；本次第 0 步没有为了测延迟而修改用户原生文件。性能目标是待实施后的验收阈值，当前没有实测“通过”的结论。

## B4. 对话模式工作区

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| 当前默认路径 | `dialogue-workspace-settings.ts:readDialogueWorkspaceSettings` 返回 ownerScopedUserDataPath('dialogues')；`localDb/dialogueWorkspace.ts` 建 `<日期>/<UI UUID>`。 | CLI 把实际 cwd 写入原生记录；loom 只创建任务工作目录 | 无项目对话的稳定 cwd | 改默认为 **`~/loom-chats/YYYY-MM-DD/UUID`**，根放在 userData、缓存和 CLI 配置目录之外；不同 dev profile 默认共用此根，各任务 UUID 独立。 | P8 |
| owner 哈希核实 | `appSessionState.ts` 始终用 LOCAL_DATA_OWNER_ID=local-v1 计算 20 字符 hash；B7 已固定它。路径仍带 owners/hash，但当前登录/退出/换账号不会再换根。 | cwd 会写 | B7 可选远程账号与本地数据独立 | 文档按当前事实说明；解决 userData 删除与开发实例分裂，不再重复引入账号隔离。 | P8 |
| 自定义根 | 设置文件保存 directory 与 previousDirectories；自定义根由 picker 建立，缺根不会被普通创建流程递归补造，避免离线卷落到本机同名挂载点。 | 后续 cwd 会写；设置只写 loom 文件 | 用户指定工作区/外接盘 | 留；已有自定义选择优先。重置使用新默认，同时保存历史选择用于识别；保持现有挂载点校验。 | P8 |
| 旧默认/恢复根 | 现有 userData/owners/hash/dialogues 与 dialogue-recovery/<hash>，以及旧 previousDirectories 已有任务。 | 旧 cwd 已写入 CLI | 已有任务续接 | 留识别，已有目录保持原地，不自动搬迁、不改旧 cwd、不重放消息。当前 profile 的旧根与已知历史 profile 根纳入只读识别。 | P8 |
| “对话”分组 | native `sessionProjection` 默认 workspaceKind=project，UI preference 可覆写；indexer 还只保留 recent_workdirs 的项目组。因此仅改新目录创建不足以完成发现/重建。 | 否 | 对话分组、清除 loom 数据后重建 | 对官方发现的 cwd 做严格根+日期+UUID 或 recovery 结构匹配，覆盖新默认、当前/已知旧默认、自定义与 previousDirectories；匹配后投影为 dialogue，并纳入发现 scope。不要仅凭目录名含 dialogues 就分类，也不要为每个 UUID 要求用户先添加项目。 | P6、P8 |
| 清除 UI 元数据后的识别 | 新默认路径模式能独立于 userData 识别；任意自定义目录的“对话”分类是用户选择，原生 cwd 自身未必携带分类。 | 否 | 原生事实完整、允许丢失 UI 选择 | 新默认和已知旧根从 cwd 重建；自定义分类丢失时重新选择该根恢复分组，CLI 会话/文件仍在。不要把 UI 分类写进 CLI 来解决。 | P8 |
| P0 验收 | 旧默认 cwd 仍位于待删除的 userData 里。用户要求旧目录不搬，无法同时保证删除整个旧目录后 cwd 仍存在。 | 本轮不写 | 无损停用 loom | 新任务用新根完成验收：记三家 native ID/路径和 cwd → 停 loom → 可恢复地移走测试 profile 的 userData → 在保留 cwd 中执行 claude --resume、codex resume、pi --session → 验证完整上下文/原文件与后续正常写入 → 重建 loom 列表和对话分组。测试经官方 CLI，不直接编辑原生记录。 | P8 |
| 旧任务的 P0 遗留 | 旧 userData 一旦真的被用户删除，里面的 cwd/产物也会消失；原生会话文件本身可能仍在 CLI home。 | 已保存旧 cwd，保持原样 | 旧任务与工作区产物 | 明确留为待确认：本批只改善新默认；如要同时修旧任务，另行批准用户选择的迁出/备份流程。禁止用自动重建空目录掩盖文件已丢失。 | P8 后续独立范围 |

## B5. 遗留清理候选

| 项目 | 现状 / 证据 | 是否会写进原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| `native archive sync deferred (failures: 1)` | `maker-host/index.ts` 在 Maker 就绪时注册 createSessionArchiveSync；`maker-host/session-archive-sync.ts` 每 60s 查旧 sessions 表，以旧 active/archived 同步 Codex 原生归档，每小时复核。顶层 reconcile/release 失败记 1，组内失败只累加计数，日志没有原始异常。 | 不是提示；会通过官方 thread/archive/unarchive 改变原生存放位置/索引 | 旧 Cindy sessions.status 对原生归档的投影；当前本机原生来源不依赖旧 sessions 表 | 建议删启动/退出 timer、requester、localDb status/cleanup 回调、仅此路径使用的 core archive host 与测试。不能只把 warn 降级或吞掉它。远程/旧缓存若仍有真实消费者，先列清引用再删除相应路径。原生归档从官方状态读；保留用户显式归档的现有语义并逐个核实入口。 | P9 |
| 归档告警原因的证据边界 | 当前日志的计数既可能来自数据库尚未就绪，也可能来自官方操作/release 失败；仅凭 failures=1 无法证明某个原因。本轮索引库使用 native_sessions，B7 实测旧 sessions/messages 为 0 行。 | 同上 | 诊断真实故障 | 清理依据是事实源归属错误和无本机消费者，不是猜测这一次异常。若保留远程消费者，先在独立诊断中保留错误原因，不借本批恢复旧状态源。 | P9 |
| 联系人设置界面 | `renderer/components/settings/contacts/` 的 ContactsSection、ManagerDialog、ImportDialog、ListPane、DetailPane、startContactsAiSession 与测试仍在；生产设置/路由没有引用 ContactsSection。bootstrap 仍注册 contacts-ipc，preload/shared/store/system-contacts/device-sync 和系统提示还有接线；实际 MCP 无 cindy_contacts。 | 设置/数据库不属于 CLI 文件；残留系统提示若被拼接则可能写入原生 system 快照 | 当前没有可到达的联系人设置功能；插件框架与官方远程账号不依赖内置联系人 | 建议按调用图整块删除 UI、IPC、preload、shared、settings/store/sync、提示、文案与对应测试；只清 zh-CN/en，历史数据库表/migration 保留。发现其他保留模块读取联系人时先断依赖，无法判定的列待确认。 | P2、P9 |

## 4. 拟拆的实施提交与验收

下列编号只是待确认后的提交边界；本次没有实施其中任何一项。每项仍执行两轮业务/代码设计审查、desktop/mobile 与受影响包类型检查、真实相关测试；删除批次收尾跑全量。互不依赖的项可以单独确认。

| 提交 | 内容 | 关键验收 |
| --- | --- | --- |
| P1 | 删除默认 user note、对账与去重空槽；保留冻结的历史 presentation 投影 | 三引擎普通发送的 wire 等于用户输入/显式附件；slash 原生命令位置正确；历史精确剥离与用户引用测试保持；已保存历史原文保持，CLI 正常追加新输入。 |
| P2 | 删除 Cindy 身份、更新/归属/Skill 优先级、计划写作规范、全局 rich-answer、空 engine append 与失效 memory/contacts 提示；清普通任务能力覆盖 | 原生 system/base prompt、用户配置/Skills/MCP 正常；所有 start/resume/fork/oneShot 入口核对；保留功能的显式例外有测试。 |
| P3 | 按确认结果清 MCP/工具默认注入，分离 Pi 扩展工具覆盖；插件/团队按需接线 | 普通任务三个引擎没有额外 host 工具；保留插件工具逐个工具列表和调用验证；Claude SDK、本地 Codex/Pi 与 SSH 的官方会话 config 使用一致边界；远端 CLI 配置零写入。 |
| P4 | 旁聊、review、goal、迁址、目录恢复、来源与显式输出格式各自最小化 | 用户明确动作与授权边界保持；普通任务无附带工作流；条件模块若已无可达入口则整块删除。Orca/goal 等先确认范围。 |
| P5 | 三家共享父环境净化与实际 clientInfo 版本 | 人工环境单测覆盖保留/剔除集合、同名旧值清除与新生成值；当前安装版本和 App source/originator 过滤复核；三家实际子进程没有外层任务标记，用户配置根/代理一致。 |
| P6 | 统一根解析、Parcel 监听、增量索引与当前页刷新 | 文件变化至界面 p95≤1s；配置/原文件只读、符号链接/重命名/压缩/离线恢复、Codex subagent 排除、空闲性能达标。 |
| P7 | 尾部活动折叠、未读水位、侧栏与 agent-island 外部来源 | 三家终态/新轮/未知/5 分钟过期矩阵；未读与显示版本一致；本地 live 优先；外部没有审批/中断动作；不把“显示空闲”当作可接管。 |
| P8 | 新默认 ~/loom-chats、旧/自定义根识别与发现 | 三家 cwd 和终端续接验证；不同 dev profile 共用默认根；登录/退出/换账号路径稳定；清测试 userData 后原生历史和新根内容保持；旧路径保持原位。 |
| P9 | 清旧 archive sync 与联系人遗留 | 启动和 60s 后均没有旧同步 timer/查询，显式归档与远程边界正常；入口、IPC、preload、测试、zh-CN/en 文案清完整；不改历史 migration。 |

## 5. 待确认

| 问题 | 已知事实 / 建议 | 需要确认的范围 |
| --- | --- | --- |
| Orca、目标模式、learn-host | slimming-plan 明确将这些列为保留并待确认；当前 Orca 25 个工具和全局策略确实仍在。 | 建议普通任务全部取消默认增补。是否继续保留独立团队/目标/学习工作流，以及工具只在这些显式任务中装配。learn-host 未列为本批功能删除目标，触达它的 prompt/Skill 路径按调用关系复核。 |
| 插件能力与严格工具一致性 | Ghost/plugin-protocol 是受保护保留框架；Agent 使用 loom 插件会形成终端默认没有的工具。 | 建议普通任务零 host 工具，明确插件任务保留六项使用工具；四项 forge 工具是否作为单独创作功能保留。不能同时宣称所有任务的工具完全一致。 |
| Pi 问答、subagent、plan-mode 和工具覆盖 | 它们来自 host 扩展，用户原生 Pi 配置可能有不同实现。 | 建议恢复普通任务原生工具；逐个确认问答卡片、宿主子代理/计划与权限 UI 的必要例外。权限与远程执行代码不能因删除提示被绕过。 |
| `/review` 后自动修复 | 当前隐藏 follow-up 会要求源 Agent 修复审查问题。 | 建议 Review 只报告，用户选择修复后再明确发送；确认是否改变现有工作流。 |
| 迁址与远程配置 | 实施时复核确认远程 MCP 已使用会话级 RPC，旧写配置注释已纠正；本机原生身份仍有跨主机保护。 | 保留功能继续使用官方会话参数；真实迁址语义按保留范围处理。 |
| 状态尾读例外与首次窗口 | 用户本次要求从文件尾推断状态；D8 当前以官方读取为原则。64 KiB 实测会缺长轮边界。 | 建议批准“仅生命周期/stopReason 尾读”例外及 1 MiB 上限、5 分钟失活；未知保持未知，正文继续官方读取。 |
| 任意 Pi --session-dir | 独立终端可把会话放在任何目录，loom 无法只靠默认根发现全部。 | 建议已知根、已有原生引用及用户指定根；不用全盘扫描。 |
| 旧对话 cwd 的 P0 | 默认根改动只保护未来新任务；旧根保留原位与“删除旧 userData 仍保留 cwd”存在实际矛盾。 | 本批不搬旧目录；旧任务若需同等 P0 保证，另确认迁出/备份范围。 |
| 父环境中 Pi runner 的 package-root | 本轮只确认该变量存在，不能仅凭名称判为用户配置或外层运行态。 | 实施 P5 前核对来源，保持用户显式配置；不猜测删除。 |
| A 段设计清单生成器 | 旧 `/plugins` catalog 使 pnpm design:inventory 失败。 | 留作独立清理；本批真实 UI 验证已通过，不借此恢复已删路由。 |

## 6. CLI 配置保护记录

开始时间 **2026-11-02 15:05:36 +08**。只读取四份文件计算 SHA-256，不读取登录凭据文件、不启动登录操作、不直接编辑任何 CLI 配置/会话。结束时间 **2026-11-02 16:02:38 +08**，四份逐项一致。

| 配置 | 开始 SHA-256 | 结束 SHA-256 |
| --- | --- | --- |
| ~/.claude/settings.json | `de84f8d396bdbed6352275ea38f0f75ad2b7a08a12f5c8693bcd1dce31a43bea` | `de84f8d396bdbed6352275ea38f0f75ad2b7a08a12f5c8693bcd1dce31a43bea`（一致） |
| ~/.codex/config.toml | `2047b6e94b48d3f324e2a3c4a9710035e4dfbb4c13ac55220c213df5cc32f971` | `2047b6e94b48d3f324e2a3c4a9710035e4dfbb4c13ac55220c213df5cc32f971`（一致） |
| ~/.pi/agent/settings.json | `bbbb34d5fb589604015c46dcae5efe1c429389d10e15614e3a09e7f48ea76753` | `bbbb34d5fb589604015c46dcae5efe1c429389d10e15614e3a09e7f48ea76753`（一致） |
| ~/.pi/agent/models.json | `8318276f06a6564350d852fd6b2a954126923e10a093fbc0b307649a57883e48` | `8318276f06a6564350d852fd6b2a954126923e10a093fbc0b307649a57883e48`（一致） |

本次不 push、不修改 Git 历史、不修改 reference/。B 段只留下本文作为待审方案；确认前不开始 P1–P9。

## 7. B 段实施记录

用户于 2026-11-02 确认继续。实施普通任务默认输入清理、父环境隔离、原生实时监听与状态、新默认对话根、遗留归档同步与无入口联系人清理。依 AGENTS 的保留规则，Orca/目标/学习、插件框架及远程执行仍保留实际功能，输入与工具仅服务于明确启用的功能；旧对话目录保持原地。Review 默认只报告，显式选择修复后发送结果。

开始于 **2026-11-02 16:06:59 +08**。四份配置起始 SHA-256 与 §6 的结束值逐项一致，实际记录在 `/tmp/loom-b8-implementation-config-start.json`。各提交的检查与两轮审查见下文，最终类型检查、全量测试和配置核对见 §7.2。

- P1 已实施：普通 send/steer/溢出重放取消 UI 语言、客户端设备/手机产出偏好和计划对账；设备与输入授权元数据继续透传。历史显示使用 native-sessions/legacy-input-notes 的冻结文本，只影响派生展示。side-chat、消息作者、明确目标模式与 MCP App 上下文保留在各自触发路径。业务审查与代码设计审查通过；desktop/mobile typecheck 均 0 错误；11 个测试文件、478 项通过（b-p1-*.log）。

- P2 已实施：移除 host 身份/所有权/Skill 优先级、三引擎行为说明、默认 rich-answer 协议、插件 roster 和无工具面的联系人说明；删除两个空 engine append 及未引用 fallback prompt。CLI 原生 preset 和明确 userPrompt/设备托管执行事实继续保留。业务与设计审查通过；desktop/mobile/maker-core typecheck 0 错误；desktop 1 项通过，Codex 968 项通过、11 项跳过，Pi 的 18 项真实 CLI 集成测试按原环境门禁跳过。

- P5 已实施：Claude/Codex/Pi 的本地启动、模型发现与 Pi fork 统一净化父运行态环境，再叠加本任务自己的运行参数；用户配置/凭据/代理保留。SDK 0.3.292 的 options.env 为完整替换，未被 SDK 再合并父环境。Codex initialize 使用 loom + app.getVersion()，source/originator 的静态验证见 §2.3；本轮保持原生记录只读，未为验证标识启动真实模型轮次。Pi runner package-root 的来源仍待确认，保留。业务与设计审查通过；desktop/mobile/maker-core typecheck 0 错误；环境与 Codex 回归共 975 项通过、11 项跳过，desktop 配置 1 项通过。

- P8 已实施：默认 ~/loom-chats/日期/UUID；恢复目录也使用同一稳定根。保留当前/旧 owner 根、曾选自定义根，已有目录保持原位；索引发现现有日期目录并按 cwd 派生“对话”分组。旧自定义卷失联时继续保留已知 cwd 作用域。业务与设计审查通过；desktop/mobile typecheck 0 错误；3 个测试文件、42 项通过，覆盖改设置、离线卷、换 owner、重启与删除 UI 数据。真实终端 resume 会写入原生历史，本轮遵守只读约束，终端续接的人工步骤仍见 B4 的 P0 验收行。

- P6/P7 已实施：@parcel/watcher 只读监听配置后的三家目录及链接目标；150ms 防抖、持续写入 500ms 提交，队列串行；已知文件按 size+mtime 调官方单记录读取，新文件按所属引擎发现。Pi 统一 sessionDir 路径；Codex subagent 过滤保持。焦点/5 分钟签名对账、唤醒对账、根变化重订阅保留；已知追加复用项目范围，避免逐次 Git 探测。运行态只读有界尾部，5 分钟撤下进行中；本地现存运行句柄优先，外部没有审批通道。侧栏与 agent-island/菜单栏显示外部来源、进行中和未读；已读只在聚焦可见视图显示历史后确认所读文件版本。业务和代码设计两轮审查通过，配置与会话文件保持只读。
  - desktop/mobile、maker-core、native-sessions、device-link build/typecheck 均 0 错误；native-sessions 4 文件 15 项，desktop 定向 9 文件 240 项通过；Swift typecheck 0 错误（已有 macOS Text 拼接弃用警告）。真实临时目录 FSEvents 与 1000 次突发事件测试通过。
  - native-external-activity 全主题 × zh-CN/en 4/4，通过截图复核、无缺失文案；证据为 artifacts/ui-check/native-external-activity-SMmson。完整应用的 10 分钟 CPU/唤醒及端到端 p95/p99 测量尚未执行，保留 §3.4 的测量计划；隔离 UI 和事件测试不替代整机指标。
  - 并行任务已在 36aa8c3a 提交原生中断显示修复；用户确认可以合并验收，本批保留其变更并使用其新增回归。

- P9 已实施：删除旧 sessions 表到 Codex 原生归档的后台同步器、60s timer、启动 requester、调用点及专用测试；保留用户明确续接归档任务时的官方 unarchive 能力。删除无入口联系人设置、preload/IPC 29 个通道、main 工厂/系统联系人读取/变更广播、renderer 管理界面、maker-core contacts 存储/FTS/同步、device-link 旧联系人同步协议及对应测试；zh-CN/en 删除联系人文案和仅该功能使用的错误码。未改 apps/desktop/drizzle，也没有删除用户数据文件或执行表删除。deviceSyncKeyStore 继续服务现有插件设备同步，保持。业务与设计两轮审查通过；desktop/mobile/maker-core/device-link 类型检查 0 错误；core 4 文件 1005 项通过、11 项跳过，device-link 2 文件 362 项通过。保留的通用 backpressure 测试使用协议测试通道，断言保持。

- P3 已实施：三引擎普通任务取消默认 cindy_orca/cindy/orca_worker_bridge；Lead、Worker、插件来源任务分别装配所属服务，调用时再次核实绑定工作流；用户原生与自定义 MCP 保持。Codex 取消进程级 24 个 MCP -c 覆盖，显式工作流改走完整会话级配置（URL、认证环境变量、header、超时）；本机与 SSH 使用同一范围规则。远程配置调查初版把旧注释当实现，现已逐行核实并纠正：实际未写 config.toml，只写 loom 自身端口元数据。Pi 问答卡片、权限/远程执行与 managed Skills 依赖另见 P4 的保留例外，普通任务工具一致性的验收据此记录。
  - 业务审查：三家本机与 SSH 的发现/调用范围一致，保留实例绑定和冻结权限；代码设计审查：集中纯规则、复用已有 provider 和 RPC 配置，删除 argv 序列化。desktop/mobile typecheck 均 0 错误，4 个测试文件 61 项通过（b-p3-*.log）。

- P4 已实施：Review 完成后只发布卡片并关闭只读 reviewer，删除隐藏自动修复输入、转发接口与仅该链路使用的语言包装。卡片“修复审查问题”把报告与请求填入可编辑输入框，走用户正常发送流程。旁聊、真实跨机器迁址、目录恢复、消息来源和明确 Goal/Learn 保留自己的触发路径；普通输入继续为空。删除桌面原生能力替换策略（飞书、原生输出、浏览器/电脑能力）和 Claude 图片 Read 改写 hook，原生 apiKeyHelper / commit / PR attribution 使用用户配置。
  - Pi 删除压缩后的隐藏 MCP 提醒；本地 Bash/PowerShell 使用原生工具描述、参数与超时，宿主远程执行的真实超时约束保留。桌面停止额外的 host Subagent 工具，`cindy_pi_command` / `cindy_pi_extension` 默认停止注册；用户明确操作的 Pi 设置/扩展命令 UI 保留原通道。MCP schema 披露缓存、权限门、问答卡片和真实远程工具继续运行。
  - 业务审查：Review 报告发布与修复授权分开，已失效结果保持只读；原生权限、远程执行和已选工作流的功能边界保持。设计审查：删除失去生产者的策略、hook 合并器和自动转发接口；Pi 模型工具注册与用户 UI 命令通道分别配置，复用原生工具工厂。

### 7.1 保留例外与待确认

以下是本轮完成后仍存在的明确差异，不能把本轮结果表述为三引擎在所有任务中完全一致。历史文字保持原样，presentation 的精确剥离继续只影响显示。

| 项目 | 现状 / 证据 | 是否写入原生会话文件 | 依赖它的保留功能 | 建议 | 拟拆的提交 |
| --- | --- | --- | --- | --- | --- |
| Codex `features.goals=false` | 现有 Goal controller 在 thread/start 后才可开启目标；配置仅在建/续线程时应用。把关闭规则只移到 send 时，已有线程不会应用，现有双续跑回归证明需要启动时关闭。 | 生效配置可能记录；旧记录保持 | 保留的 Goal 预算、暂停和 origin 生命周期；只读 Review 同样要求独立终态 | 本轮保留并明确差异。待确认：删除 loom Goal，或先改为任务启动前确定模式，再仅为 Goal/Review 关闭原生续跑。 | 后续独立 Goal 生命周期调整 |
| Managed Skills 目录 | Claude/Pi 启动仍加载三项内置 Skill 和用户已批准、已启用的插件 Skill；Codex 默认不建立全局投影，catalog 仍列出资源。Pi `preparePinnedPiSkillInvocation` 要求真实 loaded `skill:learn` 及精确来源路径。 | 被调用后的内容/调用会；普通目录元信息可进入原生系统上下文 | 显式 /learn 的来源核验、内置创作和现有插件 Skill 选择器 | 保留已验证目录，取消普通 roster 已完成。待确认：将加载与选择器/核验改为按任务资源装配，逐步取消启动目录差异；本批不通过删除资源破坏保留功能。 | 后续按任务 Skill 装配 |
| Pi `ask_user_question` | 使用现有 RPC 问答协议与 loom 问答卡片 | 调用和回答会 | 保留的模型主动问答卡片及远程回答 | 保留这一项额外模型工具并记录例外；是否改为仅使用用户原生扩展，另确认 UI 功能取舍。 | 待确认问答卡片范围 |
| Pi 原生工具工厂覆盖 | 本地 grep/find/ls/bash/powershell 的原生 schema 保持；外层只保留受管 rg、Review 可见路径、shell 控制面变量剥离；设备托管使用所在电脑执行器 | 实际调用/结果会；本轮取消本地超时教学文字 | Windows 执行路径、只读 Review、权限与真实远程文件/命令 | 保留确有执行依赖的包装。默认本地不引导到宿主包管理；其模型工具关闭，UI 通道仍可用。 | P4 已实施；执行层另评估 |
| 插件使用与 Forge | source=plugin 任务装配 cindy 六项使用工具和四项 Forge 工具，普通任务不隐式挂载。内置 creator Skill 已明确工具不可用时继续本地源码工作，并报告打包/安装能力边界。 | 显式工具调用/结果会 | 受保护的插件框架、插件创建/安装 | 保留显式插件任务；独立“创作任务”如何启用四项 Forge、如何按单个插件收窄资源仍待确认。本批没有向普通任务恢复全局工具。 | 后续显式创作任务范围 |
| Memory 系统段 | maker-core 模块仍存在；desktop 没有 manager / enable 开关，当前普通运行输入为空 | 当前默认不写；其他显式调用者启用时会 | 尚存 core 可选接口；桌面普通任务无依赖 | 本轮保持关闭；清可选 core 功能需独立确认调用者，不为没有启用的接口新增替代。 | 后续 core 瘦身候选 |
| 旧对话目录、任意 Pi 根与整机指标 | 旧 cwd 保持原位；未知 --session-dir 无法从原生默认根推断；本轮只有临时目录事件和 UI 验证 | 本轮只读 | 历史无损、配置指定根、性能验收 | 旧目录迁出仍需独立批准；任意 Pi 根使用用户指定发现。整机 CPU/唤醒和端到端 p95/p99 按 §3.4 继续测量，尚未给出实测达标结论。 | 独立迁出 / 性能验收 |

  - 收尾审查补正：SSH Claude 的旧二次注入路径也按工作流过滤，普通远程任务不创建 forward；设备执行路径复用已过滤的 Pi 环境描述。删除失去桌面调用者的 Pi Subagent runner Host/Process、Forge 构建条目、lint 特例及专用测试；插件 utilityProcess 与原生用户扩展保持。保留测试中的远程传输/冻结权限场景明确声明 Lead/Worker，增加普通远程任务零服务、零 forward 回归。

  - P4 定向验证：desktop/mobile/maker-core typecheck 0 错误；核心 4 文件 1096 项通过、12 项按门禁跳过；Review 4 文件 65 项通过；收尾 5 文件 53 项通过；MCP 启动/身份/远程 4 文件 74 项通过。UI changed 全主题 × zh-CN/en 共 348/348，通过 overview 及 Review 草稿、原生停止、外部状态截图复核；证据 artifacts/ui-check/changed-M2kpth。启动发现租约允许已启用工作流在 thread/start 返回前列工具，工具执行仍要求真实实例绑定，新增回归覆盖这一时序。

  - 全量首轮暴露的生产依赖问题：native-sessions/index 直接 import agent-island/service，形成 index → island → localDb/远程/宿主 → index 的循环，33 个 suite 在加载阶段失败。改由 bootstrap 把外部状态发布函数注入索引，索引只依赖共享类型；原有 33 文件回归全部通过，保留原 mock 与断言。首轮另有 1 项已停用 Pi runner 的接线断言，随已删除功能整项移除，保留 Node/插件运行器 6 项通过。最终全量结果见 §7.2；首轮日志保存在 b-final-desktop-full-before-import-fix.log。

### 7.2 最终验收与配置保护

业务逻辑审查完成：普通输入、按角色的工具范围、Review 修复授权、原生状态/未读、对话根、归档与联系人清理符合本轮确认范围；保留例外见 §7.1。代码设计审查完成：索引通过启动层发布回调隔离 UI 服务，循环依赖已根因修复；删除功能的入口、死实现和专用测试一起清理。当前保留功能没有已知阻塞问题。

| 验证 | 实际命令 | 结果 |
| --- | --- | --- |
| Desktop 类型 | `pnpm --filter desktop run typecheck` | 0 错误 |
| Mobile 类型 | `pnpm --filter mobile run typecheck` | 0 错误 |
| maker-core 类型 | `pnpm --filter @cindy/maker-core run build` | 0 错误 |
| Desktop 最终全量 | `cd apps/desktop && pnpm exec vitest run --maxWorkers=2` | **2218 文件通过、5 文件跳过；32822 项通过、32 项跳过；0 失败**。676.76s；b-final-desktop-full.log |
| Mobile 全量 | `cd apps/mobile && pnpm exec vitest run --maxWorkers=2` | **692 文件、9729 项通过；0 失败**。172.53s；b-final-mobile-full.log |
| Core 相关 | `cd packages/maker-core && pnpm exec vitest run src/agents/pi/__tests__/cindyBridgeSource.test.ts src/agents/pi/__tests__/pi-provider-routing.test.ts src/agents/claude-code/__tests__/flag-settings.test.ts src/agents/codex/index.test.ts --maxWorkers=2` | 4 文件、1096 项通过、12 项按门禁跳过；0 失败 |
| 加载边界回归 | 对首轮 33 个加载失败文件运行 `pnpm exec vitest run <33 files> --maxWorkers=2` | 33 文件、1346 项通过；原 mock 与业务断言保持；随后全量也通过 |
| 原生与远程相关 | P6/P7 的 native-sessions、device-link 构建，以及监听/尾部状态/读取水位/来源 UI 回归 | 类型 0 错误；记录与数字见各实施项。本轮未运行需要写入用户原生记录的真实模型轮次或终端 resume |
| Swift | 既有 native-agent-island typecheck 命令 | 0 错误；保留已有 macOS Text 拼接弃用警告 |
| UI | `pnpm ui:check --changed --theme all --locale zh-CN,en` | **348/348 变体通过**；overview、Review 草稿、原生停止及外部状态截图已复核；artifacts/ui-check/changed-M2kpth |

日志统一在 `/tmp/loom-b8-checks/`。整机空闲 CPU/唤醒次数和真实文件写入到界面的 p50/p95/p99 仍按 §3.4 测量计划验收，当前只报告已经运行的检查。

B 段实施结束配置核对时间：**2026-11-02T18:38:50+08:00**。仅计算文件摘要；四份与 16:06:59 +08 的起始记录逐项一致。

| 配置 | 开始 SHA-256 | 结束 SHA-256 |
| --- | --- | --- |
| ~/.claude/settings.json | `de84f8d396bdbed6352275ea38f0f75ad2b7a08a12f5c8693bcd1dce31a43bea` | `de84f8d396bdbed6352275ea38f0f75ad2b7a08a12f5c8693bcd1dce31a43bea`（一致） |
| ~/.codex/config.toml | `2047b6e94b48d3f324e2a3c4a9710035e4dfbb4c13ac55220c213df5cc32f971` | `2047b6e94b48d3f324e2a3c4a9710035e4dfbb4c13ac55220c213df5cc32f971`（一致） |
| ~/.pi/agent/settings.json | `bbbb34d5fb589604015c46dcae5efe1c429389d10e15614e3a09e7f48ea76753` | `bbbb34d5fb589604015c46dcae5efe1c429389d10e15614e3a09e7f48ea76753`（一致） |
| ~/.pi/agent/models.json | `8318276f06a6564350d852fd6b2a954126923e10a093fbc0b307649a57883e48` | `8318276f06a6564350d852fd6b2a954126923e10a093fbc0b307649a57883e48`（一致） |

结束记录：`/tmp/loom-b8-implementation-config-end.json`。本批没有直接编辑用户 CLI 配置或会话，没有 push、重写 Git 历史、改动 reference/ 或历史 migration；界面文案只改 zh-CN/en。用户确认的并行原生停止修复（36aa8c3a）已合并验收，最终完整工作区检查通过。

### 7.3 Review 修正（2026-11-03，Claude）

B8 提交后复审外部状态与未读，修正三处在真实数据下才暴露的问题：

| 问题 | 原因 | 修正 |
| --- | --- | --- |
| loom 自己跑完的 Claude 任务显示“外部 · 进行中”约 5 分钟 | SDK（`entrypoint: sdk-ts`）和 Claude 桌面写的 jsonl 没有 `turn_duration`，轮次以 `stop_reason: end_turn` 的 assistant 收尾；本机样本 sdk-ts / claude-desktop 均如此 | 尾部规则把 `end_turn`、`stop_sequence`、`max_tokens`、`refusal` 和 `[Request interrupted by user…]` 记为轮次结束 |
| 首次启动时全部原生任务未读，岛面被刷满 | 未读只比较 `lastViewedAt ?? 0`，从没在 loom 打开过的任务都算未读 | `native-ui.json` 增加 `unreadSince`（首次建立索引的时间，持久化）；未读 = 写入时间晚于 max(unreadSince, lastViewedAt)。loom 关闭期间终端的新写入，下次启动仍算未读 |
| 每一行侧栏都显示“外部”，loom 自己任务的完成/出错状态被覆盖 | 所有非本机运行的任务都带 `externalActivity` | 只有尾部判定为进行中时才带 `externalActivity`（否则为 `null`，经 device-link JSON 也能清掉）；空闲任务回到原有岛面状态，原生未读只补一个绿点。岛面上 loom 自己的记录优先，只有新的外部轮次才替换；外部未读沿用岛面 4 小时 TTL |

实测：`--isolated=loom-b7-remote`（16 个任务）启动后写入 unreadSince；经 CDP 读侧栏 7 行，只有当前正在终端运行的 Claude Code 任务显示“外部”，其余无标签、无误判未读。主进程 60 秒 CPU 时间 1.29 s（dev 构建，期间外部任务持续写入）。四份 CLI 配置 SHA-256 与 §7.2 一致。
