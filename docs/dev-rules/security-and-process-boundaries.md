# 安全与进程边界

> **状态**：权威
> **读取时机**：新增 Tauri 命令、权限、外部进程或修改 CSP 之前

## 页面不可信

页面会渲染任务内容，而任务内容可能来自网页、仓库文件和工具输出。所以：

- 后端命令必须校验参数，不能相信页面传来的路径。任务 id 必须是 UUID，并在项目目录里查找（`sessions::find_task_file`）。
- 续接任务时，工作目录取自任务文件本身，不接受页面传入。
- `open_external` 只允许 `http` 和 `https`。
- 不用 `dangerouslySetInnerHTML`。Markdown 通过 `react-markdown` 渲染。

## 不产生意外的网络请求

- CSP 限制页面只能访问自身和 IPC。不要放宽 `img-src` 和 `connect-src`。
- Markdown 里的远程图片只显示替代文字，否则打开任务就会发请求。
- 网页链接点击后用系统浏览器打开，WebView 保持当前页面。本地链接使用受任务上下文约束的 `resolve_task_path` / `open_task_path`，工作目录来自原生任务，动作限于系统默认打开和访达定位，路径按独立参数传给 `open --`。链接文字来自模型输出，指向 `.app`、`.command`、`.terminal`、`.pkg`、AppleScript 这类打开即运行的文件时只在访达中显示（`local_files::runs_when_opened`）。

## 权限

`capabilities/default.json` 只授予需要的权限。新增权限要说明用途。不要引入能让页面直接执行命令或读写任意文件的插件。

`tauri-plugin-dialog` 和 `tauri-plugin-notification` 只供后端调用，能力文件没有授予页面它们的权限。页面通过自己的命令发通知和更新菜单栏。

## 附件

- 页面只拿到附件 id，不能传路径。路径只来自后端打开的系统文件对话框和窗口拖入事件（`attachments.rs`）。
- 粘贴的图片由页面传字节，后端按文件头校验类型和大小。
- 5 MB 以内的图片随消息发送。其他文件和更大的图片只把路径写进提示词，由 agent 读取。
- 附件文件给一条 `Read(//路径)` 规则，只放行这一个文件，同样存在内存里，只作用于当前任务。路径含通配符或逗号时不给规则，走普通确认。
- 任务文件里的图片只有 png、jpeg、gif、webp 会传给页面。
- 队列预览使用本地 `queue-image://localhost/<任务 UUID>/<附件 UUID>`。两个 ID 都校验为 UUID，只读取 `~/.tandem/queues/images/` 的队列图片，按文件头返回栅格图片类型；响应使用 `no-store`。CSP 的 `img-src` 只为该本地协议增加权限，读取在阻塞线程执行。

## 手机访问

- 默认关闭。协议和安全边界见 [中转协议](../relay-protocol.md)，手机能做的事只有 `remote/ops.rs` 列出的操作。
- 确认配对用后端弹的系统对话框，不经过页面，页面渲染不可信内容，不能让它批准设备。
- `ws://` 只允许本机地址，其他必须 `wss://`。

## Codex

- 启动和续接线程只传 `sandbox: read-only`，权限只放在 `turn/start`。不要在 `thread/start`、`thread/resume` 或它们的 `config` 里传可写沙箱，那会让 `app-server` 改写用户的 `config.toml`。改动这里要先在临时 `CODEX_HOME` 里验证。
- 模式对应：默认权限是 `on-request` 加工作区可写，自动审批是 `never` 加工作区可写，完全访问是 `never` 加无沙箱。
- 不用 `acceptWithExecpolicyAmendment`，它会写用户的规则文件。
- 写入者探测对 `thread-writer-locks/<id>.lock` 取一瞬间的共享锁，每 5 秒一次。

## 项目和窗口

- 菜单栏面板是单独的窗口（`tray-panel`），第一次点图标时才创建。它的能力文件只有事件和主题，操作只能走 `tray_panel_action` 的固定名单。
- 面板的 `refresh` 动作只向主窗口发出固定刷新事件，保持面板打开。主窗口复用已有任务、写入者和 CLI 读取命令，完成后向面板回传结果。

- 添加项目的路径由后端打开的系统对话框返回。新建任务的工作目录来自页面，这是用户选择项目的方式。
- "在访达中显示"按任务 id 查任务文件，用文件里记录的工作目录，不接受页面传路径。
- 当前分支只读 `.git/HEAD`，不运行 `git`。
- 设置页的 Agent 分页会对找到的 `claude`、`codex`、`pi` 各运行一次 `--version`，并读 Claude 和 Codex 的登录状态，5 秒超时。只在打开这个分页时运行，启动时不运行。
- 安装只运行 `npm install -g <固定名单里的包>`，登录只运行 `claude auth login` 和 `codex login`。都是用户点按钮才运行，凭证由 CLI 自己保存，Tandem 不碰。页面不显示 CLI 路径。
- Pi 的模型和密钥不由 Tandem 配置。
- `core:window:allow-set-theme` 用于让窗口材质和红绿灯跟随设置页选择的主题。

## 外部进程

- CLI 从登录 shell 的 PATH 查找，用参数数组启动，不拼 shell 字符串。提示词通过 stdin 以 JSON 传入。
- 工具授权和提问走 `--permission-prompt-tool stdio`。CLI 每个控制请求都要回复，否则会一直等，处理不了的也要回错误（`runner::parse_control`）。
- 页面只回答请求，不能改内容：工具输入留在后端，页面只传决定。回答必须对应还在等待的请求。
- 桌面回答命令区分 `answerFailed` 与 `requestSettled`。提交期间卡片保留并禁用操作；回传失败显示错误、恢复操作并保留输入，已结束的请求移除卡片。手机端继续使用既有错误协议。
- 模型、推理强度和权限模式按白名单校验后才变成参数，防止页面传入别的 CLI 参数。
- "完全访问"只有用户在输入框确认后才会传，默认权限不传 `--permission-mode`，让用户自己的 CLI 设置生效。
- "本任务都允许"只作用于当前任务，存在内存里。不写 CLI 建议的 `localSettings`。
- 停止任务先发 `SIGTERM`，让 CLI 写完会话文件，3 秒后再强制结束。

## 测试入口

只在调试版提供，用 `#[cfg(debug_assertions)]` 隔离。正式版不能有通过环境变量执行脚本的入口。

Codex 原生历史的本机图片由后端解析器读取，限制栅格扩展名、文件头、5 MB 和普通文件，图片数据随历史返回。这个入口接收原生 CLI 的图片块，页面只持有 data URL 或错误标记。Agent 配置清单的字段与错误脱敏边界见 [Agent 配置清单](agent-configuration-inventory.md)。
