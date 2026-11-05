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

测试脚本改过的 `localStorage` 要在结束时还原，调试版和正式版共用这份数据。Codex 的实测会写进用户真实的 `~/.codex`：测完用 `thread/delete` 删掉测试线程，并比较 `config.toml` 的哈希。

`TANDEM_DRIVE_PANEL=1` 打开菜单栏面板，测试点不了菜单栏图标。`TANDEM_DRIVE_CLOSE=<秒>` 到时间关主窗口，和点红色按钮走同一条路。`TANDEM_DRIVE_PAIR_FILE=<路径>` 把配对码写到文件，`TANDEM_DRIVE_PAIR_ALLOW=1` 代答配对弹窗，这几个都只在调试版生效。

安装、登录和拿不到真实触发条件的卡片，用替身 CLI 测：把 `ZDOTDIR` 指向一个目录，里面的 `.zshrc` 和 `.zlogin` 只放替身的 `PATH`。这样不动用户的真实账号和全局安装。

`TANDEM_DRIVE_ATTACH=路径:路径` 按拖入窗口的方式送入附件，系统文件对话框驱动不了时用它测试。

脚本在窗口加载约 1 秒后执行，可以操作 DOM。设置这个变量时窗口会浮在最上层且不抢焦点，否则页面会被挂起。这段代码只编译进调试版（`#[cfg(debug_assertions)]`），正式版没有这个入口。

输入框要用原生 setter 赋值，React 才能收到变化：

```js
const box = document.querySelector('textarea');
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, '你好');
box.dispatchEvent(new Event('input', { bubbles: true }));
```

截图只截这个窗口，不要截整个屏幕：用 `CGWindowListCopyWindowInfo` 按进程找到窗口编号，再执行 `screencapture -x -l <窗口编号> out.png`。

驱动真实任务时，放在临时目录里用最短的提示词，不要动用户现有的任务。发送前脚本必须确认页面上选中的工作目录就是这个临时目录，对不上就中止：新建页默认选最近的项目，通常是这个仓库本身。选择器要限定在弹出的列表里，侧边栏的项目行也带同样的 `title`。

## 容易踩的坑

- 隐藏或被遮挡的 WebView 不触发 `requestAnimationFrame`，内存也会被回收。不要用它等待首屏，内存要在窗口可见时测。
- 页面代码要兼容 Safari，`vite.config.ts` 的构建目标是 `safari16`。
