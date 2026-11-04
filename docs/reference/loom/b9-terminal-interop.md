# B9：终端互通收尾

> 2026-11-03。对应 architecture.md §4.3（单写入者）、§6（终端互通）、D3（改名写回）。

## 1. 单写入者（P4）

同一个原生任务在别处打开时，loom 只读跟随，不发送。

| 引擎 | 判据 | 说明 |
| --- | --- | --- |
| Claude Code | `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json` 的 `sessionId`，pid 存活且 `procStart` 一致 | `procStart` 是 C locale + UTC 的 `ps lstart`；`ps` 按 `LC_ALL=C TZ=UTC` 读取。`entrypoint: claude-desktop` 记为 Claude 桌面版 |
| Codex | `<CODEX_HOME>/thread-writer-locks/<id>.lock` 的持有进程 | 用 `lsof -t -w` 只读查看，不取锁；不用 `lockf`（它会短暂拿锁，且默认执行后删除文件）。命令路径含 `ChatGPT.app` / `Codex.app` 记为 Codex app |
| Pi | 无锁、无 pid 记录 | 只看尾部是否在一轮中；空闲但开着的终端 Pi 无法检测 |
| 全部 | 尾部处于一轮中（5 分钟失活） | 兜底，记为「loom 之外运行」 |

loom 自己的子进程（沿 ppid 回溯到 loom 主进程）一律不算外部写入者。实测：Codex app 持有的线程识别为 `codex-app`（含 `ps`+`lsof` 约 490ms），终端里运行的 Claude Code 识别为 `terminal`（约 50ms），无人持有为 `null`。

- 守卫：`bootstrapSession` 续接已有原生任务前调用 `assertNoNativeExternalWriter`；loom 每轮结束都会关闭自己的进程，所以每次发送都会经过这里。
- 界面：任务视图用 `ExternalWriterOverlay` 替换输入框（沿用 WorktreeCreatingOverlay / TakeoverMask 的 90px 规格），「重新检测」手动刷新。占用期间每 5 秒复查一次，因为锁或进程释放时不一定有文件事件。
- 写入者探测现场 stat 文件后读尾部，不用缓存。缓存的尾部可能早于 loom 本轮的最后一次写入（`closeSession` 先于本轮的索引刷新）。

## 2. 在终端继续

任务菜单（侧栏行、卡片、顶栏共用 `SessionTaskMenu`）新增「在终端继续」（仅 macOS）和「复制终端命令」。仅对本机、已有原生记录、未归档的任务显示。

- 命令：`claude --resume <id>`、`codex resume <id>`、`pi --session <文件>`，前面 `cd` 到任务目录；全部用单引号转义。由用户 PATH 里自己安装的 CLI 执行。
- loom 正在跑这一轮时拒绝；空闲时先关掉 loom 持有的进程句柄。打开终端前再查一次外部写入者，避免出现第二个写入者。
- 打开方式：在私有临时目录写一个 `.command` 文件交给系统打开（默认 Terminal，或用户关联的终端），脚本运行时先删除自己。

## 3. 改名写回原生

只走各 CLI 的官方接口，loom 不直接写会话文件：

| 引擎 | 接口 | 原生记录 |
| --- | --- | --- |
| Claude Code | Agent SDK `renameSession(id, title, { dir })` | 追加 `custom-title` |
| Codex | app-server `thread/name/set`（utility host，不加载线程） | `session_index.jsonl` 的 `thread_name` |
| Pi | 用户安装的 pi-coding-agent 库 `SessionManager.open(file).appendSessionInfo(name)` | 追加 `session_info` |

- 只有用户改名（`persist=true`）写回；自动标题（`persist=false`）仍只在 loom 内存里。
- 流程：改名先记为 `native-ui.json` 的 `pendingTitle`，列表马上显示新标题和「待同步」；没有其他写入者时立即写回，之后以原生标题为准。有外部写入者、仍是草稿或写回失败时保持挂起，在之后的索引刷新、或写入者探测发现已释放时重试（失败 60 秒退避，占用检查 5 秒节流）。
- Pi 的 `open()` 会就地迁移旧版本文件，所以只对已经是当前格式（v3）的文件写回；旧格式拒绝，文件不变。
- 实测（b7-remote dev profile 上的测试任务）：Pi、Claude 各追加一行官方记录，原有字节的哈希不变。Codex app 占用的线程改名后保持挂起，`session_index.jsonl` 和 rollout 文件的大小都没有变化；测试用的挂起标题随后从 `native-ui.json` 中清除。

## 4. 外部跟随的显示

- 只有签名、没有正文的 Claude thinking 块（CLI 不保存 thinking 正文）不再生成显示行。正在运行的最后一段之前会因此多出一行空白。
- 原生文件变化时合并最新一页，不再清空整个视图（原来每次写入都整页重载、闪烁）；最新一页里缺失的旧行（终端 rewind / 压缩）才退回整页重载。本地推送改为按 `changedIds` 过滤。
- 外部轮次运行时，消息流按运行中渲染：最后一组显示「正在工作…」并实时计时。展开后的实时活动行（loom 自己跑时显示的最近 5 条）暂不支持：历史视图把运行中的组交给本地实时流渲染，外部任务没有实时流。
- 上下文用量从尾部读取：Claude `message.usage`（input + 两种 cache + output）、Codex `token_count.last_token_usage` 与 `model_context_window`、Pi `usage.totalTokens`。Claude 记录里没有窗口大小，按以下顺序确定：loom 自己跑 Claude 时 SDK 报告的窗口（按模型记进 `native-ui.json` 的 `contextWindows`）；启动时从旧 `sessions` 表只读预置的各模型窗口（正式 profile 有 `claude-opus-5-5` → 1,000,000）；用量超过 200K 时只能是 1M 档。仍未知时圆环显示 token 数。不对外部任务调用 SDK `getContextUsage`，因为那需要 `--resume` 一个进程，等于多出一个写入者。
- 尾部扫描在状态和用量都找到前按倍数扩大窗口（64KB 起，上限 1MB），大工具结果之后的用量也能读到。

## 5. 验证

见提交信息。四份 CLI 配置文件的 SHA-256 与 B8 §7.2 一致。
