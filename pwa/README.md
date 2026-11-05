# Tandem PWA

React 19 + Vite + TypeScript + Tailwind 手机客户端，使用桌面端 design token。任务列表与消息列表虚拟化，相机扫码模块按需加载，消息和运行快照只存内存。唯一持久业务数据是 IndexedDB 中的配对身份、准入令牌和不可导出的 P-256 签名私钥。

## 运行

需要 Node 24 和 pnpm。

```sh
cd pwa
pnpm install --store-dir .pnpm-store
pnpm dev
```

按 [relay README](../relay/README.md) 启动 relay 与 fake-host，将开发工具输出的 `tandem-pair:` 配对码粘贴到页面。浏览器 localhost 可以使用 `ws://`；手机和生产环境使用 HTTPS + WSS，相机与 WebCrypto 都要求安全上下文。先添加到手机主屏幕，再在该 PWA 中配对。

支持按项目列任务、历史分页、图片占位、新建任务、模型和强度选择、默认／允许编辑／模型支持的自动权限、发送、停止、确认、单选／多选／自由回答、断线重连、live.snapshot 补齐及撤销提示。权限与项目最终由桌面端裁决。连接中断时正在发送的请求显示结果未知，用户确认状态后再发起操作。

布局使用安全区与 VisualViewport 高度适配键盘；Enter 发送、Shift-Enter 换行，输入法确认候选词保留在输入框。

## 检查与部署

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

协议测试复现 [固定向量](../docs/relay-test-vectors.json)，验证错误 MAC、签名、顺序和密文的拒绝。真实 relay/fake-host 协议端到端测试在 `relay/pnpm test` 中运行。浏览器测试需要可启动的本机 Chrome，使用独立临时配置，不访问用户浏览器配置；真实启动 relay、fake-host、Vite 预览并覆盖配对、消息、确认、提问、页面刷新与撤销，finally 关闭服务。截图写入 `/tmp/tandem-pwa-permission.png` 和 `/tmp/tandem-pwa-revoked.png`。

将 `dist/` 部署到 HTTPS 静态站点根路径；可用 relay README 的 Caddy 配置合并托管。应用可以连接配对码指定的独立中转，不使用第三方服务。

Service Worker 仅在生产构建启用。构建时生成固定外壳清单，预缓存 HTML、构建后的 JS/CSS、图标和 manifest，更新时清理旧外壳；WebSocket、协议消息及任意额外网络响应均不缓存。新版本等待旧页面关闭后接管。离线时能打开已缓存页面，任务内容需要桌面端在线重新获取。

生产首屏 gzip JS 约 90 KiB，扫码约 48 KiB 单独加载；CSS 引用完整桌面 token。当前环境 Chrome 启动被 SIGABRT 终止，浏览器截图和 iOS 相机、键盘、主屏幕安装仍需在可启动浏览器与真机环境验收。
