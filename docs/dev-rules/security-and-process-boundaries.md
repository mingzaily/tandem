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
- 链接点击后用系统浏览器打开，WebView 不跳转。

## 权限

`capabilities/default.json` 只授予需要的权限。新增权限要说明用途。不要引入能让页面直接执行命令或读写任意文件的插件。

## 外部进程

- CLI 从登录 shell 的 PATH 查找，用参数数组启动，不拼 shell 字符串。提示词通过 stdin 以 JSON 传入。
- 不用 `--dangerously-skip-permissions`。没有审批界面时，需要授权的工具由 CLI 拒绝，并提示用户。
- 停止任务先发 `SIGTERM`，让 CLI 写完会话文件，3 秒后再强制结束。

## 测试入口

只在调试版提供，用 `#[cfg(debug_assertions)]` 隔离。正式版不能有通过环境变量执行脚本的入口。
