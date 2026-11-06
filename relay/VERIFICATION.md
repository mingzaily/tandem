# 中转、PWA 与站点验收记录

首次验收日期为 2026-11-05；下文的镜像和原生桌面指标保留该批次结果。2026-11-06 的 review 修正与复验记录见文末，截图已更新为复验产物。

本次完成 Rust 中转重写、Docker 与发布配置、VitePress 文档站、PWA 手机界面及协议扩展。追加授权后，已完成桌面端准入确认、逻辑断连、相对配对期限、快照计时和长期令牌重登记。代码保留在工作区，发布由后续的提交和 tag 触发。

## 实现与范围

- `relay/` 独立 Cargo 项目，Tokio / axum / tungstenite。删除 TypeScript 服务端，TypeScript 保留为开发和测试工具。Rust 依赖树包含零个 TLS 库。
- 中转保留健康接口、房间隔离、令牌哈希、一次性准入、文件格式、原子持久化、IP 限流、连接限额、帧大小限制、积压保护、ping / pong 和关闭码。准入帧及 4 MiB 硬上限在正文读取前校验。
- Docker 多阶段构建，scratch 运行层包含静态 Rust 二进制、PWA 与 LICENSE / NOTICE，以 `65532:65532` 运行；HTTP / WS 共端口，数据卷、内置健康检查、SIGTERM 退出。Compose 与 GHCR 双架构 workflow 已写入。
- `site/` 独立 VitePress 构建，首页与用户文档分开，内部 `docs/` 保留在站点之外。内容覆盖部署、环境变量、nginx / Caddy、安装配对、安全、升级和排错。Pages workflow 已写入。
- PWA 使用桌面 token 与品牌图形，加入 Markdown / 高亮、工作折叠、工具与思考展开、压缩与中断提示、按项目分组、Agent 图标与运行状态、底部模型 / 强度 / 权限面板、确认与提问卡片、六位确认码、系统深色模式、安全区和键盘视口适配。
- 协议新增可选 `allow.id → allow-ack` 与 `disconnect.conn`，桌面端与 fake-host 均已接入。配对采用 `ttlMs`，原有 `expiresAt` 登记继续接受；运行快照与事件携带 `startedAtMs` 和单调计时的 `elapsedMs`。
- 桌面端文档地址为 `https://mingzaily.github.io/tandem/guide/quick-start`。追加授权的源代码改动集中在 `remote/link.rs`、`remote/mod.rs` 及 `commands.rs` 的异步配对命令；其他 agent 的桌面端和工程管理改动保留。

## 业务逻辑审查

已审查准入、转发隔离、权限、持久化失败、连接替换、撤销、快照、消息分页、请求生命周期及外部 Agent 失败路径。已完成这些根因修复：

1. 关闭帧排在已接受的最终回复之后，解决桌面端发送 `pair4` 后立即撤销一次性令牌时的回复丢失。
2. PWA 等待已接收消息的异步解密完成，再处理配对连接关闭，解决最后一帧仍在解密时错误拒绝配对。
3. 新连接忽略旧连接关闭产生的错误。
4. 每个 Agent 独立加载模型，单个 Agent 失败时其他 Agent 继续可用。
5. 撤销清理工作区状态，支持重新配对；完成的运行在历史同步期间保留明确状态，已结束请求从确认卡片中移除。
6. 配对登记确认后再展示配对码，长期登记确认并保存本地身份后再发送 `pair4`；确认等待上限 10 秒，超时结束配对并重连。
7. 待确认登记绑定具体配对令牌，取消或替换后的迟到确认清理原登记，旧弹窗结果只作用于原配对。
8. 签名、握手顺序、计数器和密文校验失败均释放对应逻辑连接；其他加密会话继续可用。
9. 重连先重登记全部长期哈希，确认后再同步清单；中转准入文件丢失时，已有手机身份仍可恢复准入。
10. 运行计时使用单调时钟，快照保留开始时间和已运行时长；请求与结束事件并发时，已结束轮次保持终态。

本次授权范围内的已知阻塞问题已修复。

## 代码设计审查

已审查模块边界、状态归属、异步顺序与错误路径。Rust 按协议规则、房间状态、持久化及连接 I/O 分工；PWA 的消息构建为纯函数，展开状态保存在虚拟列表外，Markdown 与扫码按需加载。持久化失败保留错误语义并继续后续写入。CSS 引用的设计 token 均有定义。桌面连接按登记用途和握手阶段管理状态，配对设备的本地落盘在阻塞线程中完成，保存成功后提交内存身份。新增状态只在启用远程访问或运行任务时使用，依赖清单保持原样。

## 验证结果

| 范围 | 实际检查 | 结果 |
| --- | --- | --- |
| Rust | `cargo test --locked` | 10 个单元测试通过 |
| Rust | `cargo clippy --all-targets -- -D warnings` | 通过，零警告 |
| Relay 工具 | `pnpm typecheck`、`pnpm test` | 类型检查通过，14 个测试通过 |
| Relay 构建 | `pnpm build` | macOS release 构建通过 |
| PWA | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过，13 个测试通过 |
| PWA 浏览器 | `SHOTS=… pnpm test:browser` | 4 个尺寸 / 主题组合全部通过；追加批次 40 张截图，含重载计时 |
| 桌面 Rust | `cargo test --locked --quiet` | 146 个测试通过 |
| 桌面前端 | `pnpm typecheck`、`pnpm test` | 类型检查通过，64 个测试通过 |
| 桌面构建 | `pnpm tauri build --debug --bundles app` | 调试版构建通过 |
| 真实桌面端 | `pnpm interop` | 确认延迟 / 超时 / 取消、四类违规连接、令牌重登记、快照计时及原互通流程通过 |
| 容器 | `docker build -f relay/Dockerfile -t tandem-relay:verification .` | linux/arm64 构建通过 |
| 容器端到端 | `PWA_ORIGIN=http://127.0.0.1:32775 pnpm test:container` | 健康接口、CSP、PWA、真实 WebSocket 配对与列表通过 |
| Site | `pnpm build`、`pnpm test` | 类型检查与构建通过，1 个链接 / 产物测试通过 |
| 发布配置 | YAML 解析 | Compose、GHCR、Pages 均通过 |
| 变更检查 | `git diff --check` | 通过 |

Relay 原有六组场景全部保留；新增帧头拒绝、全局 256 连接、可信代理、准入确认、逻辑断连、最终回复关闭顺序、ping 与超大二进制帧场景。Rust 测试覆盖持久化失败后恢复、0600 权限、Node 文件格式、令牌编码与有效期、积压计数及代理取址。

真实桌面端互通使用 `ZDOTDIR` 和临时 CLI 数据目录。实际通过六位配对、读取 3 条消息与图片占位、4 类越界请求拒绝、流式事件、提问回答、运行快照、递增序列及撤销。测试前确认 `remote.json` 尚未存在，结束后删除本次文件，页面 localStorage 恢复并校验相等。测试使用替身 CLI，用户 CLI 配置和任务文件保留原状。

桌面端 `cargo clippy --all-targets -- -D warnings` 被 8 处已有告警阻挡：`attachments.rs` 的字符匹配、`commands.rs` 的两个函数参数数目、`queue.rs` 的两个函数参数数目与测试克隆、`runner.rs` 的枚举体积、`git_info.rs` 的测试表达式。本次远程模块没有新增告警，这些其他模块的代码保留原样。

Vite 对 Lucide 的 `use client` 指令有客户端构建提示；此 PWA 使用纯客户端渲染，构建和浏览器验证通过。

## 实际看过的截图

截图保存在仓库的 `docs/measurements/assets/pwa/`，下表使用相对链接。

已逐张查看以下 20 张必需截图，确认五个页面在两种宽度、两种主题下的布局：

| 视口 / 主题 | 配对页 | 任务列表 | 任务 | 确认卡片 | 提问卡片 |
| --- | --- | --- | --- | --- | --- |
| 390x844 浅色 | [配对](../docs/measurements/assets/pwa/pwa-390x844-light-pair.png) | [列表](../docs/measurements/assets/pwa/pwa-390x844-light-list.png) | [任务](../docs/measurements/assets/pwa/pwa-390x844-light-task.png) | [确认](../docs/measurements/assets/pwa/pwa-390x844-light-permission.png) | [提问](../docs/measurements/assets/pwa/pwa-390x844-light-question.png) |
| 390x844 深色 | [配对](../docs/measurements/assets/pwa/pwa-390x844-dark-pair.png) | [列表](../docs/measurements/assets/pwa/pwa-390x844-dark-list.png) | [任务](../docs/measurements/assets/pwa/pwa-390x844-dark-task.png) | [确认](../docs/measurements/assets/pwa/pwa-390x844-dark-permission.png) | [提问](../docs/measurements/assets/pwa/pwa-390x844-dark-question.png) |
| 360x740 浅色 | [配对](../docs/measurements/assets/pwa/pwa-360x740-light-pair.png) | [列表](../docs/measurements/assets/pwa/pwa-360x740-light-list.png) | [任务](../docs/measurements/assets/pwa/pwa-360x740-light-task.png) | [确认](../docs/measurements/assets/pwa/pwa-360x740-light-permission.png) | [提问](../docs/measurements/assets/pwa/pwa-360x740-light-question.png) |
| 360x740 深色 | [配对](../docs/measurements/assets/pwa/pwa-360x740-dark-pair.png) | [列表](../docs/measurements/assets/pwa/pwa-360x740-dark-list.png) | [任务](../docs/measurements/assets/pwa/pwa-360x740-dark-task.png) | [确认](../docs/measurements/assets/pwa/pwa-360x740-dark-permission.png) | [提问](../docs/measurements/assets/pwa/pwa-360x740-dark-question.png) |

另查看了六位码、模型 / 强度面板，以及文档站首页和快速开始。浏览器测试还逐页校验页面宽度、顶栏可见性、Markdown 图片与 HTML 边界、模型分组、实际默认强度、完全访问、确认、提问、新建、刷新、撤销、重新配对及部分 Agent 模型读取失败。

## 最终镜像与内存

| 项目 | 实测 |
| --- | --- |
| 本机镜像 | `tandem-relay:verification` |
| 架构 | linux/arm64 |
| 镜像 ID | `sha256:1c200c7936b5a6d236f1a1fac8a08db2c84f4befbe9c1f383b521a0c60ac43cd` |
| `docker image inspect .Size` | 2,112,981 字节，约 2.02 MiB，未压缩大小 |
| 容器用户 | `65532:65532` |
| 冷启动空闲内存 | `docker stats --no-stream`：1.809 MiB |
| 完成浏览器访问后空闲内存 | 最终镜像采样 1.188 MiB |
| 健康状态 | healthy，`/healthz` 为 `{"ok":true,"v":1}` |

内存为整个中转容器的 Docker MemUsage，网关与浏览器另计。SIGTERM 测试正常退出，退出码为 0。本次启动的测试容器、测试数据卷、调试版桌面端和预览进程均已清理。其他 agent 的调试进程继续运行。构建产物和本地验证镜像保留供复核。

## 桌面端追加授权验收

五项配合均已实现。协议、fake-host、PWA 与用户排错文档同步更新。配对使用中转接收时开始的相对期限，桌面端期限从发起登记起按单调时钟计算，包含确认等待时间。

`pnpm interop` 使用测试代理丢弃第一次登记确认，验证 10 秒超时；第二次延迟确认并取消配对，验证迟到确认继续隐藏配对码；第三次确认后完成配对。代理检查所有 `allow` 携带 ID、长期确认之前尚未发送 `pair4`、全部长期登记确认后才发送 `allow-sync`。运行过程中删除中转准入文件并重启，桌面端恢复已配对设备的哈希并重新落盘，手机原有身份可重新建立加密会话。随后发送握手乱序、错误签名、错误计数器和错误密文，四条连接均被关闭，正常手机会话继续读取与回答提问。该历史批次使用旧关闭码 `4400`；当前 `disconnect` 的关闭码为 `4411`，互通脚本断言已同步。

PWA 浏览器测试在确认等待期间重载页面，将手机 `Date.now()` 偏移一小时，恢复快照后仍延续原运行时长。实际查看四张 `followup-<宽>x<高>-<主题>-permission-recovered.png`，覆盖 390×844、360×740 的浅色与深色，计时和确认卡片均保持可见。

桌面端启动与常驻内存未单独重新测量；本轮没有新增依赖，远程关闭时保持现有启动路径。上表容器指标来自追加批次重新构建的当前镜像。

## 未验证与真机检查

以下范围留待相应环境验收：公网 WSS、真实 iPhone / Android、iOS 主屏幕存储隔离、扫码相机权限、软键盘与刘海安全区、系统深色模式切换、锁屏及后台恢复、移动网络切换。桌面端真实账号和真实 CLI 任务保持隔离，互通测试使用替身 CLI。

GitHub Actions、GHCR 推送、GitHub Pages 正式发布及 linux/amd64 镜像尚未执行；工作流已配置 amd64 / arm64。仓库提交与 tag 发布后，检查 Pages Source 为 GitHub Actions、GHCR 包的访问权限和实际域名 / 证书。

真机建议按顺序验收：安装到主屏幕 → 在安装后的 PWA 内配对并核对六位码 → 打开与新建任务 → 确认和回答 → 弹出 / 收起键盘 → 深色模式 → 锁屏与切换网络 → 在电脑撤销设备。公网地址使用 HTTPS / WSS，反向代理读超时大于 90 秒。


## 2026-11-06 Review 修正与复验

本轮修改集中在发布配置、relay 文档、PWA、站点和路线图，未编辑 `desktop/`，保留工作区中其他任务的桌面端改动。未提交或发布。

### 修正结果

- 中转发布 tag 使用 `relay-v*`，桌面端保留 `v*`。镜像同名版本标签和 `latest` 只随中转 tag 更新；手动分支构建使用 SHA 标签。relay 与站点的维护文档同步说明版本标签。
- 必要的 PWA 截图复制到 `docs/measurements/assets/pwa/`，其余旧截图移除链接。本文中的图片链接全部使用仓库相对路径。全仓库扫描未发现本机用户名或临时截图目录的绝对路径；参考规范中的通用示例路径保留。
- PWA 中断标记使用 CirclePause、`status-paused`、与桌面一致的字号和图标占位。中英文的思考、调用工具、回复、等待确认、工作过程、截断、压缩与中断等 12 个共享文案及输出单位均与桌面对照一致，单位为 `tok`。
- 连接正常时移除连接状态行；连接中和离线时展示状态，操作错误继续以错误提示显示。任务列表与运行状态使用“等你确认…”。
- 路线图的已知问题补充“手机看不到待发送队列”。
- 站点首页、快速开始、反向代理页检查了桌面和手机的浅色、深色布局，未发现遮挡、主题错配或页面水平溢出。长代码块保留框内滚动。链接测试增加锚点校验。

### 两轮审查

业务逻辑审查：核对发布命名空间、版本标签、连接生命周期、正常与错误状态显示、跨端文案和截图可移植性。已有准入、转发及加密协议保持一致。

代码设计审查：复用现有状态、图标库和设计 token；运行状态与思考过程使用各自的文案键，移除正常连接的展示键；测试通过真实中转和协议替身验证显示行为。延迟准入确认的测试保留数据帧先于关闭事件的顺序。

本轮范围内无已知阻塞问题。

### 实际验证

| 范围 | 检查 | 结果 |
| --- | --- | --- |
| Relay | `cargo test --locked` | 10 项通过 |
| Relay | `cargo clippy --all-targets -- -D warnings` | 通过，零警告 |
| Relay | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过；14 项集成测试，release 构建通过 |
| PWA | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过；13 项测试 |
| PWA 浏览器 | 390×844、360×740，各浅色与深色 | 四组端到端通过，生成 48 张截图，页面无横向滚动 |
| PWA 文案 | 中英文共享文案对照桌面端 | 12 个键一致 |
| Site | `pnpm build`、`pnpm test` | 类型检查、生产构建和链接／锚点测试通过 |
| Site 浏览器 | 三页 × 1440×1000 / 390×844 × 浅色 / 深色 | 12 组通过，无页面溢出或浏览器错误 |
| Site 链接 | 遍历 9 个页面的链接与锚点 | 56 个站内目标均有效 |
| 发布规则 | YAML 解析与 tag 匹配检查 | `relay-v0.1.0` 匹配，`v0.1.0` 独立于中转触发规则 |
| 变更检查 | `git diff --check` | 通过 |

PWA 首屏 JS gzip 为约 101.20 kB，Markdown / 高亮约 104.97 kB 继续按需加载。本轮未增加依赖、常驻计时器或额外网络请求；启动和内存未单独重新采样。上文容器与原生桌面数据属于首次验收。

已目视检查并保留 28 张 PWA 截图：四组尺寸／主题下的配对页、列表、任务、中断标记、确认、提问、连接中与离线状态。前五种页面见上方 20 张截图表，连接状态见下表。

| 视口 / 主题 | 连接中 | 离线 |
| --- | --- | --- |
| 390x844 浅色 | [连接中](../docs/measurements/assets/pwa/pwa-390x844-light-connecting.png) | [离线](../docs/measurements/assets/pwa/pwa-390x844-light-offline.png) |
| 390x844 深色 | [连接中](../docs/measurements/assets/pwa/pwa-390x844-dark-connecting.png) | [离线](../docs/measurements/assets/pwa/pwa-390x844-dark-offline.png) |
| 360x740 浅色 | [连接中](../docs/measurements/assets/pwa/pwa-360x740-light-connecting.png) | [离线](../docs/measurements/assets/pwa/pwa-360x740-light-offline.png) |
| 360x740 深色 | [连接中](../docs/measurements/assets/pwa/pwa-360x740-dark-connecting.png) | [离线](../docs/measurements/assets/pwa/pwa-360x740-dark-offline.png) |

已目视检查并保留以下 12 张站点截图：

| 宽度 / 主题 | 首页 | 快速开始 | 反向代理 |
| --- | --- | --- | --- |
| 1440px 浅色 | [首页](../docs/measurements/assets/site/home-1440-light.png) | [快速开始](../docs/measurements/assets/site/quick-start-1440-light.png) | [反向代理](../docs/measurements/assets/site/proxy-1440-light.png) |
| 1440px 深色 | [首页](../docs/measurements/assets/site/home-1440-dark.png) | [快速开始](../docs/measurements/assets/site/quick-start-1440-dark.png) | [反向代理](../docs/measurements/assets/site/proxy-1440-dark.png) |
| 390px 浅色 | [首页](../docs/measurements/assets/site/home-390-light.png) | [快速开始](../docs/measurements/assets/site/quick-start-390-light.png) | [反向代理](../docs/measurements/assets/site/proxy-390-light.png) |
| 390px 深色 | [首页](../docs/measurements/assets/site/home-390-dark.png) | [快速开始](../docs/measurements/assets/site/quick-start-390-dark.png) | [反向代理](../docs/measurements/assets/site/proxy-390-dark.png) |

本轮启动的中转、预览服务、浏览器及测试数据均已清理，留存仓库内的必要截图和临时目录中的测试产物。

### 本轮未验证

真实手机、iOS 主屏幕存储与相机／软键盘／后台恢复、公网 WSS、真实 nginx / Caddy 部署、GitHub Actions 实际触发和 GHCR / Pages 发布尚待对应环境验收。本轮未重新运行真实桌面端 CLI 互通，也未重新构建或测量 Docker 镜像。

## 2026-11-06 逻辑断开与限流重连修正

`disconnect` 改用 `4411`，仅结束指定房间中的本次手机会话，长期准入令牌继续有效。已配对 PWA 对 `4411`、`4429` 使用现有指数退避：从 1.5 秒开始翻倍，上限 30 秒，加密握手成功后重置。`4400`、`4401` 保持终止重试，`4410` 保持撤销语义。

配对连接继续采用单次尝试；已收到的最终回复先完成解密，再处理关闭。测试分别覆盖 `4410`、`4411` 收尾，以及 `4411`、`4429` 提前关闭时的单次失败。

fake-host 增加首次握手断连注入，集成测试通过真实 Rust 中转验证：首次握手收到 `4411`，PWA 自动重连并继续加密请求。另验证相同长期令牌重新准入、跨房间隔离，以及 `revoke`、`disconnect` 都先发送最终数据再发送关闭帧。原生互通脚本的关闭码断言和协议、README、站点排错文档同步更新。本轮未编辑 `desktop/`，未提交或发布。

| 范围 | 检查 | 结果 |
| --- | --- | --- |
| Relay | `cargo test --locked` | 10 项通过 |
| Relay | `cargo clippy --all-targets -- -D warnings` | 通过，零警告 |
| Relay | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过；16 项集成测试 |
| PWA | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过；21 项测试 |
| PWA 浏览器 | 390×844、360×740，各浅色与深色 | 四组端到端通过，无页面横向滚动 |
| Site | `pnpm typecheck`、`pnpm build`、构建后 `pnpm test` | 全部通过；页面链接与锚点有效 |
| 变更检查 | `git diff --check` | 通过 |

业务逻辑审查：核对会话断开与令牌撤销的边界、配对收尾顺序、重连间隔与手动关闭取消重试，相关回归通过。代码设计审查：直接调整关闭码与现有终止集合，复用原有退避流程；测试替身的故障注入仅作用于首次有效会话握手。两轮审查无已知阻塞问题。

本轮改动集中在连接逻辑与说明，未重新目视截图；上轮目视检查的 PWA 28 张与站点 12 张截图见前文。本轮启动的测试进程均已退出。真实桌面端互通、真实手机、公网 WSS 和 Docker 镜像未在本轮重新验证。

## 2026-11-06 最终 Review 清单验收

按最终清单重新核对，保留已完成的 `4411`／`4429` 退避、中断标记、`tok`、等待确认文案与正常连接布局。本轮补齐以下行为，未提交或发布：

- 桌面端通过 `disconnect.code` 区分异常会话 `4411` 与未知／已撤销身份 `4410`，中转仅接受这两个关闭码，房间隔离和令牌撤销边界保持一致。正在握手的设备同样按撤销处理；配对最终回复先于关闭帧发送。
- `host.info` 返回当前与历史 `conversationRoots`，手机按目录边界将任务归到“对话”。分组顺序采用电脑上的项目顺序，组内按更新时间倒序。
- 项目排序状态由 App 管理，Sidebar 拖动后保存到 localStorage，并通过 `remote_update_context` 的 `context.projectOrder` 更新后端。上下文变化通知手机重新读取项目与任务。
- PWA 合并同一轮连续的文字／思考增量，保留工具及其他事件边界，同时保留已有状态与快照对象。10,000 段连续文本测试验证完整内容只占一个增量事件。
- 准入文件损坏时启动错误包含文件路径、备份恢复及桌面端重新登记的处理方法；测试检查文件内容保持保密。两份工作流的 16 处 Action 引用固定到官方仓库核对的完整 commit SHA。
- 协议、fake-host、互通脚本、README 与站点配对／排错说明同步。

### 验证结果

| 范围 | 检查 | 结果 |
| --- | --- | --- |
| Relay | `cargo test --locked` | 10 项通过 |
| Relay | `cargo clippy --all-targets -- -D warnings` | 通过，零警告 |
| Relay | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过；19 项集成测试，release 构建通过 |
| PWA | `pnpm typecheck`、`pnpm test`、`pnpm build` | 全部通过；27 项测试 |
| Desktop | `pnpm typecheck`、`pnpm test`、`cargo test --locked` | 全部通过；前端 127 项、Rust 154 项 |
| Desktop 构建 | 独立应用标识的 debug app | 构建通过 |
| 真实桌面互通 | `pnpm interop` 调用 `desktop-interop.mts` | 配对、流式、确认／提问、计时恢复、令牌重登记、异常连接隔离、未知身份 `4410`、实际侧栏拖动顺序和对话分组通过 |
| Site | `pnpm build`、构建后 `pnpm test` | 类型检查、构建、链接与锚点测试通过 |
| Site 浏览器 | 四页 × 两种宽度 × 浅色／深色 | 16 组通过；9 个页面、56 个站内链接与锚点有效；无浏览器错误或页面水平溢出 |
| PWA 浏览器 | 390×844、360×740 × 浅色／深色 | 四组端到端通过；48 张截图，无横向滚动 |
| 工作流 | YAML 解析与 SHA 引用检查 | 两份工作流的 16 处引用通过 |
| 变更检查 | `git diff --check` | 通过 |

业务逻辑审查：复核关闭码和设备身份生命周期、配对最终帧顺序、目录边界、分组排序、事件顺序及快照恢复，相关单元与真实互通回归通过。代码设计审查：排序采用单一状态来源，协议新增字段在生产实现和替身中同步；增量合并使用独立纯函数，直接复用现有重连机制。两轮审查无已知阻塞问题。

### 实际目视的截图

PWA 目视了四组尺寸／主题下的配对、六位确认码、列表、任务、强度、模型、工具确认、重载后的确认、提问、连接中、配对失效、离线，共 48 张。使用四组对照图检查，并额外查看了窄屏确认原图。站点目视了首页、快速开始、反向代理、配对页，在 1440×1000 与 390×844 下的浅色和深色，共 16 张。布局、换行、弹层与按钮均可见，长代码在代码框内滚动；本轮未发现额外布局问题。

保留本轮分组变化与新增配对页检查的 8 张原始截图：

| 尺寸 | 浅色 | 深色 |
| --- | --- | --- |
| PWA 390×844 列表 | [浅色](verification-assets/final-review/pwa-390x844-light-list.png) | [深色](verification-assets/final-review/pwa-390x844-dark-list.png) |
| PWA 360×740 列表 | [浅色](verification-assets/final-review/pwa-360x740-light-list.png) | [深色](verification-assets/final-review/pwa-360x740-dark-list.png) |
| Site 1440px 配对页 | [浅色](verification-assets/final-review/site-pairing-1440-light.png) | [深色](verification-assets/final-review/site-pairing-1440-dark.png) |
| Site 390px 配对页 | [浅色](verification-assets/final-review/site-pairing-390-light.png) | [深色](verification-assets/final-review/site-pairing-390-dark.png) |

### 状态恢复与验证边界

真实桌面互通使用独立应用标识、替身 CLI 与临时配置／任务目录。测试前后原应用 `remote.json` 的存在状态和校验值一致；隔离应用的 `remote.json` 已删除，测试页面的 localStorage 备份恢复校验通过。本轮启动的桌面测试实例、中转、预览服务和无头浏览器均已退出。

PWA 首屏 JS gzip 约 101.43 kB，Markdown／高亮约 104.97 kB 继续按需加载。本轮未增加依赖或轮询；启动与内存未重新采样。真实 iOS／Android、主屏幕存储与相机／软键盘／后台恢复、公网 WSS、真实 nginx／Caddy 部署、Docker 镜像、GitHub Actions 与发布未在本轮验收。
