# Desktop 开发

> **状态**：权威
> **读取时机**：启动、验证或驱动桌面端之前

## 验证

```bash
cd desktop
pnpm typecheck
pnpm test
(cd src-tauri && cargo test)
```

界面改动还要实际运行并看截图，同时检查浅色和深色。

## 构建

| 命令 | 用途 |
|---|---|
| `pnpm tauri dev` | 开发，页面热更新 |
| `pnpm tauri build --bundles app` | 正式版，产物在 `src-tauri/target/release/bundle/macos/` |
| `pnpm tauri build --debug --bundles app` | 带脚本驱动的调试版，页面与正式版相同 |

## 驱动窗口

**不要模拟鼠标或键盘。** 系统级输入不看目标窗口：窗口被挡住时，点击和按键会落到用户正在用的其他应用上。

用调试版的页面脚本：

```bash
TANDEM_DRIVE_SCRIPT=/path/to/script.js \
  src-tauri/target/debug/bundle/macos/Tandem.app/Contents/MacOS/tandem
```

测试窗口要关掉通知（`notifyWhenDone: false`），否则会弹到用户屏幕上。每批结束删掉测试任务（Claude 的项目目录、Pi 的会话目录、Codex 的 `thread/delete`）。

页面只在内存保存状态，测试脚本通过后端命令设置配置，不读写 `localStorage`。同一应用标识共用 WebKit 运行数据，替身验收使用独立 `productName`、`identifier` 和 `TANDEM_DRIVE_DATA_DIR`，只操作临时目录。需要测真实 Codex 时也用临时 `CODEX_HOME`，结束后通过 `thread/delete` 删除测试线程。每批检查用户 CLI 配置的哈希。

`TANDEM_DRIVE_PANEL=1` 打开菜单栏面板，测试点不了菜单栏图标。`TANDEM_DRIVE_CLOSE=<秒>` 到时间关主窗口，和点红色按钮走同一条路。`TANDEM_DRIVE_PAIR_FILE=<路径>` 把配对码写到文件，`TANDEM_DRIVE_PAIR_ALLOW=1` 代答配对弹窗，这几个都只在调试版生效。

安装、登录和拿不到真实触发条件的卡片，用替身 CLI 测：把 `ZDOTDIR` 指向一个目录，里面的 `.zshrc` 和 `.zlogin` 只放替身的 `PATH`。这样不动用户的真实账号和全局安装。

`TANDEM_DRIVE_ATTACH=路径:路径` 按拖入窗口的方式送入附件，系统文件对话框驱动不了时用它测试。

`TANDEM_DRIVE_DATA_DIR=<临时目录>` 隔离整个 `~/.tandem/`，仅在调试版生效。`TANDEM_DRIVE_QUEUE_DIR=<临时目录>` 可单独隔离队列，完整存储验收优先使用 DATA_DIR。`TANDEM_DRIVE_REPORT=<路径>` 将页面发出的 `drive-report` 事件逐条写成 JSON 行，报告路径由启动环境指定。替身测试同时把 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`PI_CODING_AGENT_DIR` 指向临时目录，结束后删除替身任务、数据和测试专用 WebKit 配置目录。

替身测试的调试构建使用独立应用名称和标识：`pnpm tauri build --debug --bundles app --config '{"productName":"Tandem Audit","identifier":"com.mingzaily.tandem.audit"}'`。用 DATA_DIR 隔离文件存储；测试首次启动可直接使用空目录。正式版按上面的常规命令构建，使用仓库配置中的应用标识。

多个调试包使用独立的 `productName` 与 `identifier`。同名包反复采用不同标识时，系统的应用路径缓存会让截图工具仍按旧标识查找；独立名称让工具准确定位测试实例。

`TANDEM_DRIVE_WATCH=1` 每秒检查驱动脚本，内容变化后在当前页面执行一次。更新脚本时用原子替换，便于分阶段检查菜单和截图。该入口只编译进调试版。

同时使用 `TANDEM_DRIVE_PANEL=1` 和 `TANDEM_DRIVE_PANEL_SCRIPT=<路径>` 可在菜单栏面板里执行独立页面脚本；`TANDEM_DRIVE_WATCH=1` 同时监视主窗口与面板脚本。

脚本在窗口加载约 1 秒后执行，可以操作 DOM。设置这个变量时窗口会居中、浮在最上层且不抢焦点，让目标窗口保持完整可见，否则窗口移出屏幕后截图会出现空白区域，被遮挡的页面也会被挂起。这段代码只编译进调试版（`#[cfg(debug_assertions)]`），正式版没有这个入口。

验证原生输入光标时，使用 `open -n --env 名称=值 ... /path/TandemAudit.app` 一次传入完整的隔离环境并启动前台窗口，保持单个测试实例。直接运行可执行文件之后再执行 `open -a`，Launch Services 可能创建第二个实例并采用常规环境，截图会取到另一个窗口。页面交互继续使用驱动脚本。

输入框要用原生 setter 赋值，React 才能收到变化：

```js
const box = document.querySelector('textarea');
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, '你好');
box.dispatchEvent(new Event('input', { bubbles: true }));
```

截图只截这个窗口，不要截整个屏幕：用 `CGWindowListCopyWindowInfo` 按进程找到窗口编号，再执行 `screencapture -x -l <窗口编号> out.png`。

也可用截图工具的目标应用 getScreenshot，直接保存它返回的图像。验证窄窗口时使用保持原尺寸的截图入口；有些 get-app-state 接口会先调整窗口。脚本 resize 后重新居中，保持窗口完整落在屏幕内；测试专用 set-size/center 权限写进临时构建配置，release 继续使用仓库配置。主题切换后同时核对 computed style 与实际绘制，确认所有表面更新完成再存图。

驱动真实任务时，放在临时目录里用最短的提示词，不要动用户现有的任务。发送前脚本必须确认页面上选中的工作目录就是这个临时目录，对不上就中止：新建页默认选最近的项目，通常是这个仓库本身。选择器要限定在弹出的列表里，侧边栏的项目行也带同样的 `title`。

## 容易踩的坑

- 隐藏或被遮挡的 WebView 不触发 `requestAnimationFrame`，内存也会被回收。不要用它等待首屏，内存要在窗口可见时测。
- 页面代码要兼容 Safari，`vite.config.ts` 的构建目标是 `safari16`。
