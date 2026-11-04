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

脚本在窗口加载约 1 秒后执行，可以操作 DOM。设置这个变量时窗口会浮在最上层且不抢焦点，否则页面会被挂起。这段代码只编译进调试版（`#[cfg(debug_assertions)]`），正式版没有这个入口。

输入框要用原生 setter 赋值，React 才能收到变化：

```js
const box = document.querySelector('textarea');
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, '你好');
box.dispatchEvent(new Event('input', { bubbles: true }));
```

截图只截这个窗口，不要截整个屏幕：用 `CGWindowListCopyWindowInfo` 按进程找到窗口编号，再执行 `screencapture -x -l <窗口编号> out.png`。

驱动真实任务时，放在临时目录里用最短的提示词，不要动用户现有的任务。

## 容易踩的坑

- 隐藏或被遮挡的 WebView 不触发 `requestAnimationFrame`，内存也会被回收。不要用它等待首屏，内存要在窗口可见时测。
- 页面代码要兼容 Safari，`vite.config.ts` 的构建目标是 `safari16`。
