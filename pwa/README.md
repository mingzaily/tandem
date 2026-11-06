# Tandem PWA

React、Vite、TypeScript 手机客户端，引用桌面端的 design token。任务列表和消息列表虚拟化，Markdown、高亮和扫码按需加载。消息与运行快照只存内存；IndexedDB 保存配对身份、准入令牌及不可导出的 P-256 签名私钥。

## 运行

需要 Node 24 和 pnpm 10。

```sh
pnpm install
pnpm dev
```

按 [relay README](../relay/README.md) 启动 Rust relay 与 fake-host，将开发工具输出的 `tandem-pair:` 配对码粘贴到页面。localhost 可以使用 HTTP / WS；手机使用 HTTPS / WSS。WebCrypto 和相机要求安全上下文。

**iOS 先添加到主屏幕，再从主屏幕打开并配对。** Safari 和主屏幕 PWA 使用独立存储。主屏幕图标提供 180、192、512 像素 PNG，标志与桌面端一致。

## 界面与操作

- 配对首屏展示设备名称、配对码入口及六位确认码，引导在电脑上核对并允许。
- 任务按项目分组，显示 Agent 图标、标题、相对时间、运行呼吸效果及其他位置运行状态。刷新连接与重新配对收进连接菜单。
- 消息渲染 Markdown、GFM、代码高亮。原始 HTML 跳过，远程图片只显示替代文字，链接在新页面打开。
- 工具结果合并到对应工具行；已结束的工作折叠到“已工作 X”，思考与工具可展开，运行中的工作保持平铺。压缩与中断使用独立分隔提示。
- 模型按 Agent 分组，强度和权限使用底部面板，选中整行底色。强度显示模型的实际默认级别，选择该级别时继续由 CLI 决定。完全访问需要在面板内确认。
- 确认和提问卡片替换输入框，显示运行状态、用时及输出 token。快照和实时事件携带桌面端的开始时间与已运行时长，手机用单调时钟延续计时，重连和两端系统时钟差均保留运行用时。
- 中断标记与桌面端共用 CirclePause 图标和暂停颜色；运行状态使用“正在思考…”“正在回复…”“正在调用工具…”“等你确认…”，输出单位为 `tok`。连接正常时保留内容空间，连接中、离线和错误时显示相应提示。
- 支持分页、新建、发送、停止、单选、多选和自由回答，以及断线重连和快照补齐。撤销后停止重连，可直接重新配对。

已配对会话收到 `4411`（本次会话被断开）或 `4429`（连接／准入限额）时保留身份，按 1.5 秒起、最大 30 秒的指数退避重连，握手成功后重置。`4400`、`4401` 停止重试并提示检查协议版本与配对信息，`4410` 表示客户端未配对或已撤销，清除本机身份并提示重新配对。配对连接单次尝试，已接收的最终回复完成解密后再处理关闭；一次性配对令牌由用户重新发起使用。

任务按 `host.info.projects` 的顺序分组，`conversationRoots` 中当前和历史工作区下的任务归入“对话”。同一轮连续的文字或思考增量合并为一个事件，工具和其他事件保留边界。

深色模式跟随系统，布局使用安全区和 VisualViewport 高度适配键盘。Enter 发送，Shift-Enter 换行，输入法确认候选词保留在输入框中。目录、权限与单写入者规则最终由桌面端裁决。

## 检查

跨项目完整检查在仓库根目录运行 `node .github/scripts/verify.mjs`，包括根路径和官网子路径的浏览器验收；追加 `--image` 验证本机容器。安装浏览器、截图留存与 CI 门禁见 [CI 与本地验证](../docs/dev-rules/ci-validation.md)。

协议与浏览器测试复用 `relay/dev/` 的工具，先在 `relay/` 安装开发依赖。

```sh
pnpm typecheck
pnpm test
pnpm build
SHOTS=/绝对路径/pwa- pnpm test:browser
```

`test:browser` 先编译 Rust relay，再构建生产 PWA，使用本机无头 Chrome 与独立浏览器上下文。每个组合都测试配对、六位码、分组、Markdown 安全边界、折叠、面板、完全访问、确认、提问、新建、重载、撤销和重新配对，结束后关闭服务与浏览器。

| 视口 | 主题 |
| --- | --- |
| 390 × 844 | 浅色、深色 |
| 360 × 740 | 浅色、深色 |

每组生成 `pair`、`pair-code`、`list`、`task`、`effort`、`permission`、`permission-recovered`、`question`、`models`、`revoked`、`connecting`、`offline` 十二张截图。文件名为 `<SHOTS><宽>x<高>-<主题>-<页面>.png`，共 48 张。`permission-recovered` 验证等待确认时重载页面及手机时钟偏差一小时后仍延续运行用时；连接场景验证正常连接时状态行消失，重连和离线时提示可见。省略 SHOTS 时截图使用临时目录，测试结束清理；留存截图请指定绝对路径前缀。

协议测试使用仓库固定向量验证配对、握手、签名、密文、分片、重放和顺序；运行状态测试覆盖工具合并、折叠边界、旧连接错误和关闭前最后一帧的异步解密。

容器已经启动且使用测试令牌 `container-fixture` 时，可运行：

```sh
PWA_ORIGIN=http://127.0.0.1:映射端口 pnpm test:container
```

此测试验证容器健康接口、CSP、生产静态页面与真实 WebSocket 配对。真实调试版桌面端互通在 `relay/` 运行 `pnpm interop`，使用替身 CLI，检查并清理测试 `remote.json`，恢复 localStorage。

## 部署与缓存

官网手机端入口为 `https://mingzaily.github.io/tandem/app/`。`pwa/` 保持顶层独立项目，由 Pages 发布脚本以 `/tandem/app/` base 构建，再组合到官网产物；中转由使用者自己部署，地址来自配对码。

默认 `pnpm build` 生成 HTTPS 根路径使用的 `dist/`，继续用于 Rust relay / Docker 镜像自托管。子路径构建使用 `pnpm build --base=/tandem/app/`；图标、manifest、安装入口和 Service Worker 跟随 base。离线缓存按部署路径独立命名，更新时只清理同一应用路径的旧版本。用户部署、反向代理、手机配对与排错文档位于 [site/src/guide/](../site/src/guide/index.md)。

在 `site/` 运行 `pnpm build:pages && pnpm test` 构建并检查组合产物；在 `pwa/` 运行 `pnpm test:hosting` 验证官网入口、安装资源、离线缓存与根路径自托管。完整协议浏览器测试可设置 `PWA_BASE=/tandem/app/`，使用已按该 base 构建的产物运行 `pnpm exec tsx test/browser.e2e.ts`。

Service Worker 只在生产构建启用，缓存固定外壳 HTML、JS、CSS、图标和 manifest；任务、WebSocket 和额外网络响应只在内存中处理。旧窗口关闭后新版本接管，离线可打开外壳，任务需要电脑在线重新获取。

生产首屏 JS gzip 约 101 KiB，Markdown / 高亮约 105 KiB、扫码约 48 KiB 单独加载。手机硬件、iOS 安装与存储隔离、相机、软键盘、后台恢复及公网 WSS 需要真机验收。
