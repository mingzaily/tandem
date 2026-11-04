# B7 远程账号调查、实施与验收

状态：**四批实施与统一身份调整已完成，官方手机新建和旧会话均通过**。第 0 步只读调查及四个计划提交已完成；统一身份按用户追加确认独立提交。官方手机旧功能页面的视觉表现继续列为待确认。报告日期与最终匿名复核日期为 2026-11-02。调查基线为 `ef33b587`，恢复参考为 `fbb1010f`。用户已指定后续使用**现有官方 Cindy 手机端**。聚合证据见 [`measurements/b7-remote-auth-discovery-2026-11-02.json`](measurements/b7-remote-auth-discovery-2026-11-02.json)。

`architecture.md` §8、§9.1 已同步为 B7 的可选远程账号边界。P0、原生事实源、`local-v1` 和用户自己的 CLI 登录态继续成立。§1–§4 保留第 0 步调查与获批方案，实施结果记录在 §5–§8。

## 1. 删除与恢复范围

本轮没有删除目录、包、IPC 或设置项。现状是：桌面 `authManager`、全局认证上下文和登录页已经删除，`@cindy/auth-client` 因手机端依赖仍保留；“我的设备”“中转服务”的组件仍在，但 `RemoteControlSection.tsx` 用固定 `false` 隐藏；桌面 REST/WS 目前只消费自建中转凭据。

快照 `authManager.ts` 约 6,500 行，含账号、数据库 owner、供应商、更新和迁移职责。**提取远程需要的部分，保持这些职责分离**，不整文件回滚。

| 快照或现有部分 | 处理方案 | 原因与边界 |
| --- | --- | --- |
| `main/authManager.ts` 的登录、资源 access/refresh session、状态通知 | 提取为独立 `main/remote-auth/` 服务 | 只管理远程账号；UI 只收到登录状态和账号展示信息 |
| `@cindy/auth-client` 的普通验证码、个人社交登录、PKCE、资源 refresh/logout | 复用现有包的必要接口，宿主收窄可调用面 | 不接企业 SSO、组织管理、账户注销、Passport 多账号仓库或跨账号数据切换 |
| `authLoopbackCallback.ts`、`authBrowserLaunch.ts` 的取消、超时、state 核对 | 按需提取 | 系统浏览器 + `127.0.0.1` 随机端口 + PKCE；取消后迟到回调失效 |
| `authHostedCallback.ts`、托管回调轮询 | 本批不恢复 | loopback 已通过登录前校验；托管完成链路本轮没有验证 |
| `authRefreshBackoff.ts`、`authRefreshFailure.ts` | 提取续期单飞、退避和确定失效分类 | 只作用于远程会话，不触发本地退出或重启引擎 |
| `authCredentialStoreHealth.ts`、`safeStorageIssueLog.ts` 的加密失败诊断 | 只复用必要诊断 | 加密不可用只影响远程登录；错误只记录路由、状态、错误码 |
| `safeStorage`、原子文件助手、跨进程锁 | 复用基础设施，使用 loom 独立远程凭据目录 | 不复用供应商 secret store，不读取 Cindy 数据目录，不迁移旧账户仓库 |
| `authAccountMetadata.ts` 中账号显示字段 | 从当前登录结果投影 | 不恢复服务器资料编辑、头像上传或账号管理页面 |
| `shared/authIpc`、preload 的全局 auth API、`contexts/AuthContext` | 新增最小远程 IPC/视图状态 | 不恢复旧接口全集，不给 Renderer、device-link 对端或插件读取 token 的能力 |
| `appSessionState`、profileRegistry、localDb 生命周期 | 保留当前本地实现 | owner 始终为 `local-v1`，远程登录不调用 `beginAppSessionBoundary`、DB dispose 或 namespace 迁移 |
| `ownerNamespaceMigration`、`localProfileDataMigration`、`nativeProviderAuthBinding`、auth boundary quarantine、stable-owner auth 接线 | 不恢复账号调用链 | 登录、退出、换账号不能搬数据、清本地凭据或重建本地执行层 |
| 快照 `serverApiClient`、`clientEndpointsService` | 不恢复 | 在 device-link 内实现专用授权请求；仅有两套固定认证/官方中转地址，不拉云端点清单 |
| `updateService`、manifest、beta 默认、canary、`heartbeatService`、云账号推广 | 不恢复 | 与远程认证无关；device-link 自身协议的 ping/pong 保活继续保留 |
| `maker-host/auth-adapters`、托管 Codex account/home、网关、供应商、计费 | 不恢复 | 三家引擎继续使用 `native-cli-auth` 和用户 CLI 登录态 |
| device-link 官方 REST、WS Bearer、账号变化监听 | 重新接线 | 远程账号与本地 owner 分开；自建中转仍使用 `CindyRelay` 凭据，Cindy token 不发往自建地址 |
| “我的设备”“中转服务”现有组件 | 登录后恢复显示并启用 | 未登录时不挂载这些组件的请求/轮询；“本机应用连接”保持删除 |
| `apps/mobile` 的 auth-client、SecureStore、device-link | 保留作协议与测试参考 | 用户选择官方手机客户端，本批不恢复或发布本仓库的手机登录产品 |

必要的认证调用限于：`GET /api/auth/providers`、需要时的 CAPTCHA 挑战页、email/phone request-code 与 verify-code、个人 social authorize、`POST /api/auth/token`、必要时 `select-account`（只接受个人身份）、`refresh` 和 `logout`。账号展示优先使用登录响应中的 membership；不自动加载云资料。若个人登录被服务端要求绑定邮箱/手机，明确提示该账号流程尚不支持，不借此恢复绑定、组织或 SSO 全套能力。

device-link 专用请求覆盖当前远程实际使用的设备目录、改名/移除、媒体预签名及清理、ICE 等 `/api/device-link/*` 路由。调用面按现有调用点列白名单，不开放任意 URL 或任意带账号凭据的 fetch。手机推送注册继续由官方手机端完成。

## 2. 只读风险实测、保留部分与待确认

### 2.1 官方服务的实际响应

脚本：[`scripts/spikes/b7-remote-auth-readonly.mjs`](../../scripts/spikes/b7-remote-auth-readonly.mjs)。最终元数据见 [`measurements/b7-remote-auth-readonly-2026-11-02.json`](measurements/b7-remote-auth-readonly-2026-11-02.json)，首次基础矩阵保留在 [`2026-11-01 记录`](measurements/b7-remote-auth-readonly-2026-11-01.json)。

最终矩阵 **25 次匿名 GET**；首次基础矩阵为 24 次，补充 CN 桌面主 scheme 后复核，本阶段合计 49 次。两次均不发送 Authorization，不复用 Cookie，不跟随跳转，不发验证码，不换取 token，不刷新/登出，不注册设备。authorize GET 只检查登录前路由，可能建立短期 OAuth state；没有完成身份认证。响应正文和 OAuth state/nonce/授权 URL 查询值只在内存中检查，证据仅保存状态码、错误码、目标 origin/path 和查询键名。

| 条件 | Global | CN | 能得出的结论 |
| --- | --- | --- | --- |
| `/api/auth/providers`，`Cindy/0.0.0` 与 `loom/0.0.0` 两种 UA | 均 200 | 均 200 | 公开入口接受两种名称；不能据此断言登录后服务没有版本门槛 |
| 可用个人登录方式 | email、Apple、Google | phone、微信、Apple | 只在用户点击登录后查询、展示个人入口 |
| `client_type=desktop` + 官方 hosted callback | 302 到 Google | 302 到 Apple | 通过登录前参数校验；未验证完成回调 |
| `client_type=desktop` + `http://127.0.0.1:43187/auth/callback` | 302 | 302 | 快照 loopback 方案可用于 loom，无需改变 OS scheme |
| `client_type=desktop` + `loom://auth` | 400 `INVALID_REDIRECT_URI` | 同左 | loom 自定义回调未在现网 allowlist 中 |
| `client_type=desktop` + 快照桌面主 scheme | `cindy://auth` 为 302 | `cindy://auth` 为 302 | 快照桌面两区域共用 `cindy` scheme；B7 仍保持 loom 的系统身份 |
| `client_type=desktop` + CN 手机 scheme 交叉对照 | 未单列 | `cindycn://auth` 为 302 | 同时记录该回调被接受，不把手机 scheme 当作快照桌面主 scheme |
| `client_type=mobile` + 快照区域 scheme | `cindy://auth` 为 302 | `cindycn://auth` 为 302 | 与官方手机客户端现有回调配置一致 |
| `client_type=mobile` + `loom://auth` | 400 `INVALID_REDIRECT_URI` | 同左 | 改手机 scheme 会涉及服务端 allowlist，不纳入本批 |
| `client_type=loom` | 400 `INVALID_PARAMS` | 同左 | 保留协议客户端类型 `desktop` / `mobile`，不把产品名当成协议枚举 |
| 匿名 `/api/me`、`/api/device-link/devices` | 均 401 `UNAUTHORIZED` | 同左 | 证明鉴权入口可达；**不是**对 loom 标识或版本的拒绝证据 |
| 没有 code 的 hosted callback GET | 404 `NOT_FOUND` | 同左 | 不能据此判断成功回调是否可用，方案优先 loopback |

当前和快照桌面 package version 都为 `0.0.0`。以上 UA 是显式构造的公开入口对照，不冒充已打包客户端的实际 Electron UA。

三类标识分别处理：

- `cindy-version-protocol.json` 中的 `version: 1`，在快照里由 Cindy Make 的 `versionStore` 做**本地构建产物校验**。auth-client 和 device-link 的请求构造没有发送该文件或同名 header。本批不恢复 Cindy Make。
- device-link 的 hello 有 `platform`、`appVersion`、设备名等字段，信封 `v=1`；协议没有 `appId` 字段。`@cindy/*` 包名、既有通道与协议常量继续保留。鉴权后的 hello、最低版本限制和真实官方手机互通，必须在用户登录后验证。
- loom 的 OS 身份保持 `dev.loom.desktop`（dev 身份仍为 `dev.loom.desktop.dev`）和 `loom://`；不注册 Cindy scheme。loopback 成功页可用现有 `buildFocusDeepLink()` 生成 `loom://focus/...` 唤回应用，授权码不放进该 URL。

快照 `authManager` 和当前 `deviceIdentity.ts` 都以原始 `machineIdSync()` 为默认设备 ID。直接复用会让同机 Cindy 与 loom 产生相同设备身份；这与中转的同账号同设备连接顶替语义冲突。实施时给现有设备身份增加 loom/profile 命名空间，保证同一 profile 重登稳定、不同应用与测试 profile 分离；认证请求、device-link 自身判断和 IPC 必须使用一致的新身份。

### 2.2 凭据存储与 Codex 边界

快照的“钥匙串存储”实际是：refresh token 经过 Electron `safeStorage` 加密后写入 `userData/safe-storage/*.enc`；macOS 钥匙串保存加密密钥，access token 留在内存。快照还带多账号 aggregate vault、备份和迁移，本批不恢复。

方案使用独立远程凭据文件，保存当前个人资源会话的必要 refresh 凭据，权限 `0600`，原子写入，密钥由系统安全存储提供；access token 和临时登录票据留在主进程内存。退出删除该凭据及其备份/临时副本。系统共享的加密主密钥继续服务本机其他凭据，它不是账号 token，不作为退出时的删除对象。现有通用 safe-storage IPC 只允许 `mcp_token_*`，新远程凭据不进入该目录或接口。

已专门核对 Codex external auth：

- `AppServerHost` 只在显式提供 `externalAuth` 时注册 `account/chatgptAuthTokens/refresh` 和调用 `account/login/start {type: chatgptAuthTokens}`。
- 当前生产 `CodexAgent` 创建 host 没有提供 `externalAuth`；desktop 装配 `auth: nativeCodexAuth`，其 `getAuthEnv()` 返回 `{}`。Claude/Pi 同样走本机 CLI 认证适配器。
- 这些通用 core 能力仍在，B7 不接入 Cindy 账号，不恢复旧桌面 auth-adapters、Codex 私有账户目录或凭据同步。Codex `clientInfo.name='cindy'` 是既有 app-server 展示名，与 Cindy 云账号无关，本批不借此接回认证。
- 这属于源码和单测证据；**尚未登录，不能声称已经完成登录后三引擎进程环境/参数实测**。

### 2.3 手机现状

`apps/mobile` 仍保留完整 Cindy 账号客户端：`AuthContext` 使用 auth-client、PKCE、SecureStore；根路由未登录跳转 `/login`；`DeviceLinkContext` 从账号取得 Bearer，切号/退出清理连接、presence 与远程缓存。启动树还保留端点清单、更新/canary，不能把这棵树整体接回桌面。官方中转按账号提供设备目录，自建中转才有额外加入/审批协议；官方同账号发现不需要新建 loom 配对协议。

仓库配置中的官方手机身份是 CN `com.xd.cindycn` / `cindycn://auth`，Global `com.xd.cindy` / `cindy://auth`。这是源码配置事实，不是对用户手机已安装版本的观测。

本机只读设备清单：有 1 个已启动 iOS 模拟器，其中没有安装 Cindy/loom；实体手机当前不可连接。没有读取手机凭据、改变登录状态或启动新的手机包。用户已选择**现有官方 Cindy 手机端**，因此本批手机阶段以桌面协议兼容和真实联调为主，不编译/安装本仓库手机端，不改 bundle id、scheme、SecureStore 记录或 runtime fingerprint。官方应用自身已有的账号、更新等行为不由 loom 桌面控制。

### 2.4 待确认

1. 用户已确认独立远程账号、loopback + PKCE、固定本地 owner 方案及四个提交拆分。
2. 用户确认使用 **Global 官方手机端**；官方手机端为 **Google Play Global 0.1.28**（用户报告版本）；登录状态与实际设备连接待联调核对。只需要版本与状态，**不需要密码、验证码或 token**；真实登录由用户本人在窗口操作。
3. 用户确认：未登录时账号区域显示登录入口，隐藏我的设备/中转服务；SSH 继续显示且不依赖 Cindy 账号。

鉴权后 relay 版本准入、官方手机实际连接、真实退出清理、再次登录恢复设备目录等尚未实测，列入确认后的验收，不能用匿名 401 或代码测试代替。

## 3. 第 0 步验证结果

探测前记录了四份 CLI 配置的字节数与 SHA-256；探测后再次核对，Claude settings、Codex config、Pi settings、Pi models 全部一致。本轮没有启动三个引擎执行任务，也没有读取或修改 CLI 会话文件。

| 实际命令或检查 | 结果 |
| --- | --- |
| `node scripts/spikes/b7-remote-auth-readonly.mjs` | 最终 25 次 GET：4 个 200、9 个 302、6 个 400、4 个 401、2 个 404；首次基础矩阵另有 24 次，合计 49 次 |
| `node --check scripts/spikes/b7-remote-auth-readonly.mjs` | 退出 0 |
| `pnpm --filter desktop run typecheck --incremental --tsBuildInfoFile /tmp/loom-b7-desktop.tsbuildinfo` | 退出 0，0 错误 |
| `pnpm --filter mobile run typecheck --incremental --tsBuildInfoFile /tmp/loom-b7-mobile.tsbuildinfo` | 退出 0，0 错误 |
| `pnpm --filter @cindy/auth-client run build`、`pnpm --filter @cindy/device-link run build`、`pnpm --filter @cindy/maker-core run build` | `tsc --noEmit`，均退出 0 |
| desktop：`pnpm exec vitest run src/main/device-link/__tests__/deviceLinkApi.test.ts src/main/device-link/__tests__/ownershipAccountSource.test.ts` | 2 文件 / 3 用例通过 |
| maker-core：`pnpm exec vitest run src/agents/codex/app-server/external-auth.test.ts src/agents/codex/app-server/host.test.ts` | 2 文件 / 64 用例通过 |
| auth-client：`pnpm exec vitest run` | 6 文件 / 131 用例通过 |
| mobile：`pnpm exec vitest run src/__tests__/mobileAuthServerLogin.test.ts src/__tests__/oauthCallback.test.ts src/__tests__/nativeAppConfig.test.ts` | 3 文件 / 59 用例通过 |

以上定向检查合计 13 文件 / 257 用例通过，0 失败。本阶段没有修改产品界面和运行代码，未把旧 C1 的全量测试数字当作本轮结果；desktop/mobile 全量、UI 矩阵、启动网络抓取和真实跨设备验收在实施后执行。

业务审查已识别并在方案中切断账号 owner 迁移、设备 ID 冲突、token 向引擎扩散、未登录组件自动请求等路径。设计审查将账号、连接代次、本地数据 owner 和原生引擎认证分开；复用现有认证客户端、回调安全助手、远程组件及 IPC，不恢复全局账号框架。当前阶段只完成方案审查，实施后还需对代码再做两轮审查。

## 4. 确认后的实施与验收

### 4.1 提交拆分

| 提交 | 内容与主要接缝 | 每批检查 |
| --- | --- | --- |
| `Restore remote account login and credential storage` | 提取 `main/remote-auth/`，固定两个 realm 的最小地址，个人登录/续期/退出、loopback、独立密文、设备身份命名空间。只新增远程专用 IPC 和安全状态 DTO；不调用本地数据 owner 生命周期 | 两端及相关包类型；认证状态机、回调取消、凭据删净、迟到 refresh、零 owner 变化、零 CLI 配置写入 |
| `Add optional remote account controls to settings` | 入口只在“设置 → 远程连接”；个人登录表单、账号显示、退出。登录控件按需加载；不恢复启动登录页、全局 AuthProvider 或旧整页登录框架 | 两端类型；设置页与主界面匿名可用；未点击登录时 providers/设备/中转请求均为 0；UI 明暗主题与截图 |
| `Connect remote accounts to official device links` | 恢复官方 Bearer REST/WS 与两个面板；绑定独立远程账号代次，停止/清理只作用于远程；自建 `CindyRelay` 路径继续与账号 token 隔离；C1 数据读走原 IPC handler | 两端/相关包类型；同账号连接、401 单次刷新、切号/退出竞态、匿名零请求、自建地址零 Bearer、本地状态不变 |
| `Verify official mobile native session compatibility` | 按用户指定的官方手机版本联调，补不透明 native id、`local-v1` owner stamp 和现有通道的兼容测试；不恢复手机云账号产品或改手机原生身份 | 两端/相关包类型；官方手机实际设备目录、远程新建/列出/打开原生会话、退出与重登恢复 |

阶段 1 只提供服务与 IPC，不在启动或旧功能中激活账号；阶段 2 只显示账号入口；阶段 3 才将它交给 device-link。每一批按用户要求在检查通过后独立英文提交，不 push，不改历史 migration 和 `reference/`。

### 4.2 固定的不变量

- `appSessionState` 始终为 local，owner 为 `local-v1`。远程账户变化使用独立 epoch；本地 DB client、原生索引服务、本地会话树与设置框架保持实例和归属。退出远程连接不停止本地正在运行的 CLI 任务。
- 没有远程凭据的新 profile，以及已经退出的 profile，启动不查 providers、不 refresh、不拉设备、不连接官方 WS；主界面照常可用。曾主动登录且仍有凭据时可以后台恢复远程，失败只影响远程区域，不阻塞本地启动。
- token 只留在 Main 的远程认证/连接闭包，用于认证服务自身必要操作和选定官方 device-link。Renderer、插件、MCP、环境变量、argv、Codex external auth 都拿不到；日志仅记录固定路由/状态/安全错误码。
- 新 token、旧 token、realm、relay 路由按同一账号代次捕获；旧请求响应不覆盖新账号。自建中转的 401 不注销 Cindy 账号；官方重试不把 Bearer 改发到自建地址。
- 设备目录、展示名等派生缓存与用户偏好分开。现有 `settings-store` 的 `lastKnownDeviceNames` 不再承担官方账号缓存；恢复官方连接时改走独立远程缓存，退出只清该缓存，主题、引擎选择、SSH 和控制授权设置保持不变。
- 退出先使旧代次失效并停止远程连接/订阅/控制端，再有界尝试服务端登出，最后删独立凭据及副本、清 access token/PKCE/账号与远程内存缓存。网络失败也完成本机清理；稳定设备身份和本地设置保留。不在本地 owner 上执行旧账号 teardown。
- 本机保留“允许被控”的既有授权边界，真实验收时由用户明确开启；登录本身不扩大控制权限。

### 4.3 实际验收方法

1. 新建独立验收 profile，至少记录启动到主界面空闲的 60 秒网络请求。证据只留主机、路由模板和计数；认证/CDN/模型网关/heartbeat 等 Cindy 主机请求计数应为 0。打开未登录的远程账号区域后继续检查，直到用户点登录前仍为 0。
2. 用户本人在窗口完成个人登录，选择与官方手机同一 realm/账号。在“我的设备”核对本机和手机，开启被控后由手机发起远程任务；通过现有 `local-db:sessions:*` / `local-db:messages:*` 列出、打开 C1 的三家原生会话，不复制消息入 SQL。
3. 登录后抓取 loom 自己启动的三个 CLI 的 PID、argv 和环境。原始环境只在内存中与当前远程 access/refresh 凭据逐值比对，报告只写 PID/引擎/命中数；同时确认 Codex host 未注册 Cindy external-auth refresh，没有发送 `chatgptAuthTokens` 登录。
4. 在原生源文件不变的静默窗口，核对登录/退出/换账号前后的 owner/generation、索引逻辑内容、`native-ui.json` 与设置摘要。另跑退出时本地任务继续执行的场景；不把该任务的合法原生进度误判成账号修改数据。
5. 退出后核对远程连接、定时器、订阅和内存均清空，独立凭据及原子写副本不存在；再次登录使用同一设备身份，恢复同账号设备目录。检查失败的刷新、旧账号迟到响应和取消登录也满足这些条件。
6. 每次实测前后核对四份 CLI 配置；阶段收尾执行 desktop/mobile 及相关包 typecheck、两端全量 `vitest run`、`pnpm ui:check --changed --theme all` 并查看截图、`pnpm dev:desktop` 检查新增 `[ERROR]`。证据只存元数据、计数与哈希，真实凭据不落日志或报告。

真实官方手机版本与账号状态、鉴权后的 relay 版本限制和以上完整验收仍待实施后逐项记录。客户端 UA 固定使用 `loom/<应用实际版本>`，hello 的 `appVersion` 为 loom 自身版本；鉴权后的中转或官方手机因版本门槛拒绝时停止联调并报告，保留实际版本号。


## 5. 实施补充（2026-11-02）

loopback 先以 `loom/0.0.0` UA 对 38119、49171、62387 三个不同端口分别做匿名 authorize GET。Global（Google）与 CN（Apple）共 **6 次均 302**，未携带凭据/Cookie、未跟随跳转、未登录。结果见 [`measurements/b7-loopback-ports-2026-11-02.json`](measurements/b7-loopback-ports-2026-11-02.json)，脚本为 `scripts/spikes/b7-loopback-ports.mjs`。这验证了登录前的端口校验；实现采用系统分配端口 `listen(0, '127.0.0.1')`，监听成功后才发起 authorize。绑定失败显示登录失败，取消和超时关闭监听。

任务完成推送通过 device-link WebSocket 的 `notify` 帧发送，受服务端 notify capability 协商约束，没有桌面 POST 推送 REST。完整 REST 方法与路径清单在接线提交中逐项记录；预签名后的对象存储上传/下载使用签名 URL，不携带 Cindy 账号 Bearer。

### 5.1 登录与凭据存储提交

独立 `RemoteAuthService` 已实现个人验证码/社交登录、PKCE loopback、单飞续期、代次失效与退出。新 profile 的 restore 只读凭据存在性，匿名网络调用为 0（单测）；真实启动抓取留在接线完成后进行。refresh 密文只写当前 profile 的 `remote-auth/session.enc`，access 与临时票据留在 Main；退出删除专属目录内的主文件、备份和临时副本。通用 safe-storage IPC 保持 `mcp_token_*` 范围。设备 ID 延迟到 profile 确定后派生，loom/不同 profile 各自稳定。新增 `remote-auth:state`、`:command`、`:captcha`、`:changed`；接口只接受可信本机 Renderer，device-link allowlist 没有加入账号通道。

本批业务审查覆盖取消/续期/退出竞态、个人身份过滤、离线清理与零本地 owner 调用；设计审查保留最小 auth-client 接口、独立凭据存储、无 Electron 的状态服务及单一 loopback 资源生命周期。两端 typecheck 与 auth-client build 均退出 0；desktop 定向单测 **5 文件 / 18 用例通过**。四份 CLI 配置与实施前 SHA-256 全部一致。当前提交未启用账号启动恢复或官方 device-link，UI 在下一提交接入。

### 5.2 设置页入口提交

「设置 → 远程连接」增加可选 Cindy 账号卡片；只在点击登录后查询方式，表单按需加载，保留个人验证码/社交登录、账号展示和退出。CAPTCHA 使用临时内存 WebView 分区，只有当前登录地区的固定挑战页与 action 可附加，权限、下载、弹窗及跨站顶层导航均被拒绝。账号状态推送只发给可信应用页面。SSH 继续独立显示。设备与中转查询在本批保持关闭，下一提交接通官方线路。仅添加简体中文与英文文案，未恢复全局登录页或账号 Provider。

业务审查核对匿名零 providers/设备/中转查询、取消登录、只读状态推送与 SSH 保留；设计审查将设置订阅、惰性表单、隔离验证 guest 分开，未引入新窗口或全局账号上下文。两端 typecheck 0 错误；desktop **5 文件 / 75 用例通过**。初次 UI 运行的 12 个新增 fixture 因缺少 Router 失败，补上真实路由上下文后维持原断言，最终 `pnpm ui:check --changed=316596b6 --theme all` **164/164 通过、0 UNCOVERED**；已查看 overview 及账号页明暗截图。四份 CLI 配置 SHA-256 保持一致。

### 5.3 device-link 接口清单与账号边界

桌面官方 REST 白名单按全部生产调用点逐条收口，URL 固定取当前账号地区。Bearer 与 URL、账号代次同时捕获，401 仅在同一账号和线路下单次刷新重试；自建线路始终使用 CindyRelay，不刷新或注销 Cindy 账号。

| 方法 | 路径 | 桌面调用点 |
| --- | --- | --- |
| GET | `/api/device-link/devices` | `index.ts` 上线目录、`ipc.ts` 我的设备/侧栏目录 |
| PATCH | `/api/device-link/devices/:deviceId` | `ipc.ts` 设备改名 |
| DELETE | `/api/device-link/devices/:deviceId` | `ipc.ts` 移除设备 |
| POST | `/api/device-link/media/presign-put` | `mediaTransfer.ts` 上传签名 |
| POST | `/api/device-link/media/presign-get` | `mediaTransfer.ts` 下载签名 |
| DELETE | `/api/device-link/media` | `mediaTransfer.ts` 清理远程临时媒体 |
| GET | `/api/device-link/ice-servers` | `peerIceConfig.ts` 直连候选配置 |

WebSocket 是 `/api/device-link/ws`，任务完成推送为其 `notify` 帧，受服务端 capability 闸门控制；桌面没有 POST 推送接口。`DEVICE_IDENTITY_PATH=/api/device-link/identities` 当前只是共享包导出的契约常量，桌面生产代码没有 REST 调用，白名单不开放。自建中转的 `/relay/*`、`/pair/*`、`/admin/*` 和证书目录走既有独立 CindyRelay 路径；媒体对象存储签名 URL 使用签名而不携带账号 Bearer。

账号资源由当前 profile 的远程凭据文件锁单持有者管理（复用既有安全跨进程文件锁，无新表或 migration）。共享 profile 的其它实例保持本地功能可用，并明确显示远程账号正在被使用。退出在持锁范围内完成远程连接释放、镜像清理与凭据及副本删除，再释放锁。远程消息/草稿、显示名和缓存收据使用独立代次；本地 `local-v1` owner、会话和引擎任务保持原状态。设备名称的“写入 settings”旧实现及其旧契约测试整块移除，改用内存缓存测试与本地运行任务保留测试；设置文件中的历史字段保留读取，不做迁移。

本批业务审查针对账号代次与本地 owner 分离、官方/自建凭据路由、401 重试、退出后的迟到响应及本地运行任务保留完成根因修复；设计审查收窄为独立账号凭据端口、线路快照、内存展示名和远程缓存代次。desktop/mobile、auth-client/device-link 类型检查均为 0 错误；desktop 定向检查 **17 文件 / 258 用例通过**，包含真实文件锁、loopback、固定 local-v1 的缓存切换与本地任务保留。`pnpm ui:check --changed=703b2fea --theme all` **164/164 通过**，已查看账号/设备明暗截图；同步 hook 逻辑标记 UNCOVERED，另以 hook 单测及完整 Desktop 启动/联调验证，不把截图作为该行为的证明。四份 CLI 配置 SHA-256 与实施前一致。

安全存储补查覆盖 Linux basic_text 后端：即使 Electron 声称 encryption available，也拒绝明文后端；读取密文时校验外部数据，内部写入使用已验证的账号会话。该补充与远程前端边界检查 **5 文件 / 36 用例通过**。中转文案明确为 Cindy 官方服务，删去已删除的供应商分享/共享任务承诺。

## 6. HTTP 心跳与 device-link 在线状态补查（用户追加要求）

已读 [Cindy 隐私政策 §II.14](https://www.cindy.app/privacy)（页面标示 2026-07-26 生效）。该节说明已登录 cloud 客户端约每 60 秒上报 uid、平台和版本，并将它归于远程所需在线维护。B7 继续以源码和现网结果核对实际依赖，**保持 HTTP 心跳关闭**。

同时核对 `fbb1010f` 与 `reference/cindy` 本地上游 `main@5f0b5f42b4`：两个版本的 `packages/heartbeat-client/src/client.ts` SHA-256 同为 `5a93b14a434ab48b4a0923ace9019d3edaa4de2a2fe0f55e9f9c34ed6e01b7c4`。`heartbeatService.ts` 都从运行期端点清单取地址，仅在已验证 cloud 账号下启动，账号变化重启，退出清定时器。具体调用为：

| 项目 | 快照与上游 main 的实际实现 |
| --- | --- |
| Global | `POST https://heartbeat.cindy.app/heartbeat` |
| CN | `POST https://heartbeat.cindy.com.cn/heartbeat` |
| JSON | `uid` 必填；`platform`、`version` 在宿主提供值时携带；桌面分别取账号 user.id、process.platform、app.getVersion() |
| 认证与设备字段 | 只设置 Content-Type；该请求没有账号 Bearer，也没有 deviceId |
| 频率 | 创建后立刻发送一次，随后每 60,000 ms 一次；单次超时默认 5,000 ms；无重试/退避 |
| 停止 | stop 清 timer；旧客户端实现保留已经在途的请求 |
| 内容边界 | 该客户端 JSON 不含用量、模型、任务或消息；它与 device-link 连接模块分别在 bootstrap 初始化 |

客户端的在线链路另有直接证据：

- 桌面通过 `/api/device-link/ws` 发送 `hello`（设备信息、应用实际版本、允许被控、busy），收到 `hello-ack` 后 `DeviceLinkClient` 才设为 online，并启动 WS `ping`/`pong` 保活。当前桌面传输间隔为 15 秒；它不调用上述 HTTP `/heartbeat`。`presence-set` 用于开关和 busy 的变化，服务端 `presence-changed` 向同账号客户端分发在线与可控状态。
- 官方手机客户端源码 `DeviceLinkContext.tsx` 从 `GET /api/device-link/devices` 取目录，消费 `PresenceSnapshot.online` 和 `remoteControlEnabled`；availability 的判定来自 relay 的 presence。快照/上游这条数据路径均没有调用 heartbeatService 或 heartbeat URL。
- 可读的自建中转 `packages/device-link-relay/src/hub.ts` 在有效 hello 后把连接登记进 active map，`presenceOf()` 和 REST `deviceView()` 的 online 均为 `Boolean(active.get(deviceId))`，断开就广播 offline。这证明开源中转的在线契约；**官方中转生成 online 的后端没有在该仓库公开**，仍需现网联调确认是否另加了 uid 级门槛。

实际验收已超过要求的 330 秒：用户本人在 **Google Play Global 0.1.28** 登录同一账号、开启 loom 的允许被控，并确认能列出和打开原生会话。**2026-11-02 10:46:14–11:16:27 +08，1,812.846 秒、60 次目录采样均为 online 且允许被控，HTTP 心跳请求为 0**。记录见 [`measurements/b7-presence-without-heartbeat-2026-11-02.json`](measurements/b7-presence-without-heartbeat-2026-11-02.json)。这证明本次实际官方链路由 device-link WS 维持在线，未观察到额外 HTTP 心跳门槛。

若实测确认官方服务依赖 HTTP 心跳，立即停止接线验收并报告，另提最小上报方案等待确认：仅“已登录且用户开启远程”时运行、只发送经过实测证明必要的在线字段、退出通过账号 AbortSignal 立即取消定时器与在途请求、匿名继续零请求。此分支尚未触发，B7 没有新增 heartbeat 包、接口或定时器。

## 7. CAPTCHA 排查与用户授权的浏览器 UA（2026-11-02）

四个计划提交已完成：`316596b6` 登录/凭据、`703b2fea` 设置入口、`31503128` device-link 接线、`d9bccfd9` 手机契约及原生显示收尾。独立的版本提交 `3a9b999d` 将 loom 应用版本设为 `0.1.120`；B7 实际取 `app.getVersion()`，本轮观察到的认证 UA 为 `loom/0.1.120`，没有为登录探测单独改版本。历史匿名矩阵使用的 `0.0.0` 继续按原始证据保留。

未登录启动及打开远程设置的网络抓取持续 **651.521 秒**，共 **459,380 条网络事件**，Cindy 官方域名事件为 **0**。界面显示登录和 SSH，隐藏我的设备与中转服务。记录见 [`measurements/b7-anonymous-runtime-2026-11-02.json`](measurements/b7-anonymous-runtime-2026-11-02.json)。原始 netlog 在点击登录前结束，不随文档保存。四份 CLI 配置哈希与测试前一致。

用户本人使用 Global 邮箱登录时，人机验证失败。已修复一个确定缺陷：验证 WebView 的 `did-fail-load` 只在主框架加载失败时结束挑战，子框架错误与 `ERR_ABORTED` 保留当前验证页；与上游 `LoginCaptchaOverlay` 的判据一致，回归测试保持主框架失败、子框架失败和取消三条断言。重试后仍失败；Main 同步诊断在 **2026-11-02 10:33:01 / 10:33:15 +08** 捕获 Cloudflare 错误 **600010**。官方托管页将具体码折叠成 `err.error`，所以仅看页面回传无法定位。诊断只保存六位错误码，不保存挑战结果 token、完整 URL、控制台正文或用户邮箱。

[Cloudflare 错误说明](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/) 将 `600*` 定义为通用挑战失败；[WebView 接入要求](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/) 要求标准浏览器 API、稳定的浏览器特征和一致 UA。该错误码**不能证明 UA 是唯一原因**。同一时段 Chromium 还有 `net_error -100` 的连接关闭诊断；TLS 校验与代理配置保持现状，尚未获得针对具体挑战请求的网络失败归因。

失败时 CAPTCHA 内存分区使用纯 `loom/0.1.120` UA，缺少 Chromium 浏览器信息。用户先确认只调整验证 WebView 的 UA，随后明确授权按官方验证码窗口的做法继续尝试。当前实现取 Electron 的原生 `app.userAgentFallback`，在 guest 首次创建前固定，整个挑战期间保持一致；其中的应用标识仍是 loom，Chrome/Electron 版本直接来自运行时。认证 REST、authorize 请求、device-link REST/WS 继续严格使用 `loom/<实际应用版本>`。验证由用户本人完成，页面来源、权限、隔离分区和 TLS 边界保持原约束。**10:45:14 +08 用户确认验证通过并登录，10:45:17 device-link 上线**。

四份配置中的 Pi `models.json` 在 **10:32:19 +08** 从 7,376 字节变为 7,913 字节，SHA-256 从 `c4578dbb5634fa4e432c25bdbc54aefaabf560c6cd49441427a20e5ae7cdc0bc` 变为 `8318276f06a6564350d852fd6b2a954126923e10a093fbc0b307649a57883e48`。用户说明可能由 Magpie 升级修改，并要求保留。其余三份保持初始哈希；后续实测以用户确认保留的当前四份内容作为新基线。不能将跨越这次外部变更的整段验收描述为“四份全程相同”。

退出后的再次登录，用户报告人机验证再次失败。对应窗口已记录 11:48:22 / 11:48:33 两次 request-code，界面显示验证码已发送，未捕获新的 Turnstile 原始错误码；不能将这次用户观察归因于 UA。**11:51:38 +08 已再次登录成功并恢复 WS online**，凭据存在、内存 tokens/saved 有效；设备目录仍含桌面与手机，见 [`measurements/b7-relogin-2026-11-02.json`](measurements/b7-relogin-2026-11-02.json)。重新布局时将验证视口从 112px 恢复到首次成功时的 180px，并把验证作为弹窗内独立步骤，保留邮箱输入；超时和渲染退出只记录固定原因。

## 8. 第四批实际验收与显示改进

### 8.1 已完成的真实检查

- **未登录**：新沙箱连续 651.521 秒、459,380 条网络事件，Cindy 官方域名事件 0；登录入口和 SSH 可见，设备与中转隐藏。已登录后的退出另观察 148.120 秒，移除凭据后 Cindy 请求 0。
- **官方账号与设备**：Google Play Global 0.1.28 由用户本人登录，同账号手机已列出并打开 loom 的原生会话；实际 hello 使用 loom 0.1.120，未观察到版本拒绝。桌面品牌仍为 loom，Android 设备显示 Cindy；手机上报的协议版本字段为 0.1.0，界面如实展示，未改写为商店版本。
- **三引擎隔离**：登录后以 Main 中的实际 Cindy access/refresh token，与 loom 后代进程的完整环境和 argv 在内存中逐值比对；Claude PID 85546、Codex PID 85610、Pi PID 85544 的 token 匹配数均为 0。证据只保留计数和 PID，见 [`measurements/b7-engine-credential-isolation-2026-11-02.json`](measurements/b7-engine-credential-isolation-2026-11-02.json)。Codex external-auth 接线仍为空，未注册 Cindy 的 `account/chatgptAuthTokens/refresh`。
- **退出**：11:42:38 +08 状态变为 signed-out、device-link stopped、内存 tokens/saved 均为空，11:42:41 专属凭据目录已清空。7 份本地 UI/设置文件、index.sqlite 的逻辑内容及 83 张可直接读取的本地表摘要前后一致；sessions/messages 都为 0 行，原生消息继续现读。Python sqlite 缺少 vec0 扩展，该虚拟表未纳入行摘要。证据见 [`measurements/b7-logout-local-data-2026-11-02.json`](measurements/b7-logout-local-data-2026-11-02.json)。账号 token 始终不直接写钥匙串；共享 safeStorage 主密钥保留，退出移除 refresh 密文及副本。
- **P0**：上述检查结束时四份配置均符合用户确认的外部升级后基线；没有恢复或覆盖 Magpie 修改的 Pi models。原始基线到新基线的外部变更见 §7。

### 8.2 本批根因修复与界面调整

登录区使用设置账号行与独立登录弹窗，第三方登录、验证码表单和人机验证分步展示；验证失败或重发时清除旧的“已发送”状态。侧栏登录后展示账号名称，退出恢复本地用户；这只读取账号展示状态，不改变 local-v1。保留所有现有主题和基础控件。

Codex App 官方 items API 返回的已答问答包装转为现有 Q/A 消息行，复用实时问题转换器；图片说明包装在存在结构化图片块时转为用户正文与附件。Claude/Pi 官方接口返回的内联图片和 Codex 本地图片，仅在原生会话上下文接受受限图片地址；本地图片继续通过既有 xdt-file 和远程媒体路径读取。转换只存在于内存，原生文件和派生索引没有消息副本。用户已确认桌面的图片与问答显示正常；官方手机本轮新版图片/问答效果尚未亲自复验，用户预计相同路径可用。

活跃 Claude 会话在 listSessions 返回后仍可能追加文件，单一 UUID 文件路径直接提供最新 stat 签名；多个复制 UUID 继续由 SDK 元数据选源。新增实测故障的回归测试，防止活跃会话因时间差被从索引移除。CLI 返回的图片会展示，SDK 当前分支未返回的旧图片不通过编号猜测或解析原生格式恢复。

另外完成版本拒绝后取消旧 refresh 的竞态修复，以及后台任务只消费已完成 CLI 注册的 Maker，防止过早构造导致 Pi 缺失。原断言保留，旧 Electron mock 补齐 profile 路径。

### 8.3 官方手机端保留的边界

实际手机连接曾请求 `maker:schedule:list`、`maker:provider:list`、`maker:usage:model-pricing`、`maker:api-key:present` 和 `provider-group:remote`。桌面均在 allowlist 边界立即返回 `CHANNEL_NOT_ALLOWED`；通道、功能和旧服务未恢复，mobile 回归检查断言只请求一次并收到明确失败。

用户没有识别到这些入口，并明确 loom 不需要相关功能。**手机端各旧页面是否展示明确“不支持”、是否能返回，以及是否持续转圈，仍为未验证**；原生会话列表和打开已由用户确认正常，不能把该结果扩大为全部旧页面通过。

### 8.4 待确认与清理记录

- 重新登录与重启后均恢复了官方连接；用户从官方手机续接已有 Pi 会话，实际收到 `LOOM_B7_REMOTE_OK`。新建的 ID 契约冲突随后按 §8.6 完成统一身份调整，官方手机已确认新建发送成功，见 §8.8。
- 外部 Codex App 的待答问题属于正在运行的原客户端，loom 将它作为只读历史；已答问题展示 Q/A。实时可作答的问题继续来自 loom 自己持有的交互通道。
- `codex-clipboard-*.png` 是 Codex App 附件的临时源文件。首次核对为 14 张、4,062,967 字节，后续外部新增后为 15 张、4,259,753 字节；当前会话仍引用其中图片，未删除，也未加入自动清理。清理会影响这些原生本地图片引用。

### 8.5 官方手机新建会话：实际阻塞与处理方案（历史调查）

2026-11-02 **12:19:05–12:19:08 +08**，用户从 Google Play Global 0.1.28 新建 Pi 会话，计划发送 `LOOM_B7_REMOTE_OK` 验收消息。桌面 `maker:create-session` 成功，返回原生标识 `pi:1323e67e-a666-4164-a801-73f1bb709a70`；Pi CLI 已在用户原生目录创建该会话。用户手机显示“远程电脑上的 Cindy 版本不兼容”。

已核对具体判据：

- `apps/mobile/src/session/newSessionCreation.ts:1136` 及只读上游同文件：`result.sessionId !== task.sessionId` 时抛出 `session.new.sessionIdNotAdopted`；该文案正是手机提示。这个分支比较 **ID**，没有比较应用版本。
- 手机的 `CreateSessionOptions.id` 是自己预生成的 UUID；乐观行、路由、订阅和重试探测均以它为键。手机要求桌面采用该 ID。
- C1 的 `maker-ipc/register.ts` 在本地原生创建前调用 `createNativeDraft()` 并将 `co.id` 改为真实 `<engine>:<nativeId>`。`spike-cindy-native-projection.md` 的 Session 投影契约也明确要求该格式。Codex 原生 thread ID 必须由 CLI 返回，不能由手机 UUID 代替。
- 本次鉴权、WS、设备发现与创建 invoke 都已成功；没有 `VERSION_MISMATCH` / `CLIENT_VERSION_TOO_OLD` 服务端拒绝证据。问题发生在手机创建后的本地检查，首条 prompt 尚未进入发送阶段。此前四条 mobile 契约测试验证了已存在原生 ID 的读/续接 wire 参数，**没有覆盖官方手机的乐观新建状态机**，不能用它们宣称新建互通。

不能只把创建响应里的 sessionId 改回手机 UUID：消息推送、读取、队列、订阅、工作树以及重试幂等仍绑定实际原生 ID，会产生错投或丢失。保持真实版本与原生文件，停止这条新建接线的临时修补。

可选择的完整路线：

| 路线 | 具体改动 | 约束与代价 |
| --- | --- | --- |
| 保留官方手机，当前限定列表/打开 | 保留 B7 登录与真实原生读取，明确新建发送未通过；已有会话发送另做实测 | 当前批准的 C1 标识契约保持原样；官方新建验收继续阻塞 |
| loom 手机端接受原生 ID | 手机创建成功后，原子回填实际 ID，并同步更新乐观行、路由、队列、订阅、重试探测与工作树恢复键 | 是客户端根因修复；本仓库修改无法改变已安装的官方 Google Play App，需要调整用户选择的手机路线和后续本机安装范围 |
| 统一 UI 标识与原生引用分层 | 所有 GUI 会话使用稳定 UI UUID，单独绑定 `{engine, nativeId}`；绑定只放在允许的 UI 元数据中，所有读、写、推送和重试统一解析绑定 | 能满足官方手机预分配 UUID，但会变更 C1 当前 `<engine>:<nativeId>` 的 Session.id 决策。需先确认新的完整标识方案与重建语义，不能仅给官方手机增加特例映射，也不能新增消息事实表或改 CLI 文件 |

用户随后确认 §8.6 的统一分层路线；调查阶段保持手机断言、真实版本与原生 CLI 文件，供应商/网关等通道继续删除。

### 8.6 对照 Cindy 后的已确认方案：统一 UI ID 与原生引用分层

用户已确认统一分层并继续兼容官方手机，要求使用统一身份模型，避免新增手机特例和多条兼容分支。

只读核对 `reference/cindy` 后确认，上游 `maker-core/src/maker.ts` 的 `createSessionOnce()` 使用调用方给定的 `opts.id` 作为 GUI 会话 ID；CLI 的 `sdkSessionId` 单独回填。手机的乐观创建、重试和订阅正是以这一分层为前提。C1 将 GUI 主键直接改成原生引用字符串，漏掉了这个既有协议契约。统一分层比单独篡改创建回包完整，也能继续使用已安装的官方手机端。

作为用户批准的第五个独立提交实施，边界如下：

1. GUI `Session.id` 使用 UUID。手机预分配 UUID 在创建、回包、读取、发送、推送、队列、工作树及重试中保持一致；从终端发现的会话，以 `{engine, nativeId}` 稳定派生 UI UUID。
2. 原生引用继续为 `{engine, nativeId}`，只来自 CLI 官方接口。Codex 的 thread id、Claude 的 session id、Pi 的原生 id/路径保持原值；续接始终解析该引用。
3. UI UUID 与原生引用的绑定属于 UI 元数据，复用 `native-ui.json` 和现有草稿元数据保存。index.sqlite 的允许字段和 native_id 保持原样；会话与消息事实仍现读，不恢复 Cindy 的会话/消息数据库，不增加表或 migration。
4. 创建事务在启动 CLI 前预留 UI ID，并对同一 ID 串行/幂等；收到原生 ID 后绑定并发布。失败清理只释放该次预留，回执丢失后以同一 UI ID 探测，完整覆盖官方手机的重试语义。
5. 主进程集中解析 UI ID 与原生引用，三个引擎、本地 UI、device-link 共用；已有 native-ui 偏好按同一解析规则转换键。来源身份、账号、消息正文和权限不参与 ID 派生。
6. 删除 loom 数据后，扫描仍恢复全部原生事实；被删除的 UI 绑定会重新派生。**手机中缓存的旧 UI ID、书签或深链可能需要从恢复后的列表重新选择**，原生 CLI id 与终端续接保持不变。

用户已明确确认变更 spike §8 中 `Session.id = <engine>:<nativeId>` 的原决策，实施使用统一身份模型。下一提交同步更新 spike 和 architecture，并覆盖手机新建、回执丢失重试、已有会话续接、原生历史读取、GUI 数据重建、退出登录的数据隔离及两端完整检查。

另外，上游发送事务保留 `persistUserMessage.content` 作为显示原文，`wire` 才追加 UI language / 设备说明。loom 的原生读取必须从 wire 中投影用户正文：本批已复用实际 note 构造器识别完整首段，保留用户主动引用的说明；标题/预览截断在说明内时先显示普通占位，打开后从官方历史首条实际用户输入派生摘要，仅保存在内存并通知界面。原生文件、索引原文与 UI 自定义标题保持原样。

### 8.7 第四批提交前检查

- desktop 全量 `cd apps/desktop && pnpm exec vitest run --maxWorkers=2`：2,222 文件 / 32,896 用例通过，5 文件 / 32 用例跳过，0 失败，751.26s。先前四 worker 下两条 Git 集成用例触发原 5 秒超时，单文件 17/17 与上述全量均通过，断言和超时未改。随后仅 Main 原生显示新增检查为 2 文件 / 18 用例通过。
- mobile 全量 `cd apps/mobile && pnpm exec vitest run`：692 文件 / 9,727 用例通过，0 失败，292.38s。
- desktop、mobile typecheck 及 auth-client、device-link、maker-core、native-sessions 的类型检查均 0 错误；原生显示收尾后再次执行 desktop typecheck，0 错误。
- `pnpm ui:check --changed --theme all`：164/164 通过，0 失败。已查看界面截图；侧栏和完整会话界面以真实窗口补验，类型声明由 typecheck 验证。
- 业务逻辑审查核对可选账号、本地 owner、匿名请求、退出代次、原生读取、图片地址与官方手机实际结果；代码设计审查核对远程认证职责、已有翻译器复用和 UI 状态。临时 Main 审计探针已移除，未新增调试 IPC。统一身份调整单独实施和验证，第四批结果不代表该调整已通过。

### 8.8 统一身份调整与官方手机复验（2026-11-02）

所有本机 GUI 新建入口采用调用方 UUID；终端发现的会话使用从引擎和原生 ID 派生的 UUIDv8。主进程 `NativeUiState` 集中维护双向绑定，版本 2 的 `native-ui.json` 只保存原生引用、UI 选择与草稿目录意图。旧偏好键一次转换为 UUID，公开路径保持 UUID 契约。index.sqlite 九列字段保持原样；旧 `<engine>:<nativeId>` 解析器已删除，内部索引键与 GUI 身份各自命名。

`SessionMeta`、引擎启动参数、会话 DTO 和原生消息 DTO 显式携带 `nativeSessionRef`。Claude 的新建/resume、Codex thread、Pi `--session` / `--session-id` 从引用取值；SDK ID 与 GUI UUID 各司其职。创建对同一 UUID 合并在途分配，重试复用绑定，原生文件被外部删除时返回明确 NOT_FOUND，不另起 CLI 会话。原生会话跨执行主机的请求在宿主边界被拒绝。

来源判定改为明确元数据：未知来源与原生消息队列、历史页、镜像均只驻留内存；主机确认的旧 managed 缓存路径保持现有规则。来源元数据随手机账号代次失效。原生消息行携带引用，附件先于会话元数据到达时也能正常显示。原生标签归属保存为 UI 选择，目录继续复用既有标签表，原生会话行与消息行保持 0；此前原生标签 get 的 SQL NOT_FOUND 和带冒号 ID 的图片清理参数错误已从根因处理。

用户确认 Google Play Global 0.1.28 **新建发送成功、旧会话仍能打开**。实际桌面回流显示 GUI UUID `abe6a9e8-3194-4bcb-934e-1c0eaeb4ca26`，绑定 Pi 原生 ID `67a4414e-62f5-4e92-9701-45352b845cc5`；用户实际发送并收到 `LOOM_B7_REMOTE_OK`，没有客户端追加说明的正文噪声。前一条验收建议使用 NEW 后缀，实际发送的是上述标记，按实际结果记录。创建、订阅、推送与原生读取均使用同一 GUI UUID；没有改应用版本、UA 或伪造创建回包。

空 profile 完整重建已通过：停止未登录的 `loom-b7-rebuild`，将整个数据目录移入可恢复的 `/tmp/loom-b7-rebuild-before-reset-20261102-142159`，确认原路径为空，再以同名 profile 启动并从系统目录对话框添加 loom 仓库。两次均恢复 **8 个会话（Claude 1、Codex 3、Pi 4）**，原生引用集合与原登录 profile 一致，派生 GUI UUID 逐项一致。打开上述 Pi 会话，用户正文与准确回复均可见；重建后的 sessions/messages 均为 **0 行**。原登录 profile 随后恢复，手机分配的 GUI UUID 保持原值，用户名与官方 WS 上线恢复。证据见 [`measurements/b7-native-identity-rebuild-2026-11-02.json`](measurements/b7-native-identity-rebuild-2026-11-02.json)。

业务逻辑审查完成了三项根因修正：原生引用只选择 `engine/nativeId` 两个字段，已存在的扩展引用在正常保存时规范化；结构化历史即使 rows 为空也遵守原生/未知来源只驻内存的规则；客户端提交的 nativeSessionRef 在 Main 边界被拒绝，宿主始终使用自身绑定。外部 CLI 删除会话返回明确 NOT_FOUND，原生标签只保存 UI 归属。SQL 会话轮次边界和手机退出后的内存历史交接也保持原有隔离断言。

代码设计审查核对单一双向身份模型、来源元数据、三家执行参数及已有目录/翻译器复用，删除原生字符串前缀路由判断；没有新增手机专用响应别名、消息表或 migration。实际重启还发现 Vite 已重建磁盘依赖，但浏览器 URL 哈希保持原值而复用旧导出：现将既有内部源码指纹纳入 optimizer 配置哈希。最终复启恢复用户名、8 条列表及实际原生回复，启动与读取为 **0 条 [ERROR]**。冷依赖重建与全量测试并行时曾触发一次 30 秒 Renderer 活动守卫，缓存建立后的最终完整启动无该错误；正常退出时已有 Codex dispose 的 error 级诊断保持历史记录。

| 最终检查 | 实际结果 |
| --- | --- |
| desktop `pnpm exec vitest run --maxWorkers=2` | **2,226 文件 / 32,918 用例通过，0 失败**；5 文件 / 32 用例跳过，993.49s |
| mobile `pnpm exec vitest run` | **692 文件 / 9,729 用例通过，0 失败**；119.51s |
| `pnpm --filter desktop run typecheck`、`pnpm --filter mobile run typecheck` | 均退出 0，0 错误；侧栏收尾后 desktop 再查为 0 |
| `pnpm --filter @cindy/maker-core run build`、`pnpm --filter @cindy/maker-shared run build`、`pnpm --filter @loom/native-sessions run typecheck` | 均为 tsc --noEmit，退出 0；auth-client/device-link 在对应批次同样通过 |
| maker-core 三家执行定向 | 4 文件 / 1,166 用例通过，11 跳过，0 失败 |
| native-sessions / maker-shared 定向 | 分别 2 文件 / 9 用例、1 文件 / 2 用例通过，0 失败 |
| `pnpm ui:check --changed --theme all` | 最终改动矩阵 **138/138，0 失败**；已查看概览及侧栏常态、悬停、归档深浅色截图。前一批更大选择范围为 164/164 |
| CLI 配置 | Claude settings、Codex config、Pi settings、Pi models 四份 SHA-256 均与用户确认的外部升级后基线一致 |

上一轮沙箱执行的 macOS 文件事件用例收不到事件，在沙箱外保持原断言及超时通过；引用字段选择的回归已修实现，最终完整复跑包含该回归。没有通过删保留功能测试或改弱断言消除失败。原生队列仍只在内存保留，重启后恢复 CLI 已接受的内容；尚未被 CLI 接受的输入和空草稿执行现场不承诺冷恢复。

临时附件再次只核对文件名、大小：`codex-clipboard-*.png` 共 **20 张 / 6,369,836 字节**。当前原生历史仍引用这些源文件，继续保留。官方手机旧功能页面的“不支持”展示与返回行为仍按 §8.3 记为未验证；新增图片/问答已由用户确认桌面正常，官方手机新版效果未单独复验。


### 8.9 侧栏标题行布局（用户追加）

只读对照 `reference/cindy/.../sidebar/MainListScopeHeader.tsx`：上游右侧只有折叠和显示设置，以 opacity 隐藏并保留占位。loom 新增的常驻刷新、添加项目排在它们左侧，隐藏占位因此出现在最右端。

调整为折叠、显示设置、刷新、添加项目的固定顺序，常驻操作靠右。动作组只有一层 flex，禁止收缩；悬停操作在左侧淡入，常驻按钮保持原位置。归档状态下设置按钮继续常驻，键盘 focus-visible 和菜单展开的可见性规则沿用现有实现。界面框架、主题、按钮尺寸和各操作职责保持原样。

业务逻辑审查确认刷新、添加项目及归档提示的行为一致；代码设计审查通过调整顺序和移除重复容器直接解决占位问题。原 3 条可见性单测通过；UI 场景新增真实几何断言：添加按钮右边缘等于标题行右边缘、悬停前后 bounding box 相等、操作顺序正确，并保留刷新与添加的点击断言。全量改动矩阵 138/138 已通过，已查看常态、悬停和归档深浅色截图；独立差异再次运行 `pnpm ui:check --changed --theme all`，**4/4 通过**（10.1s），已查看最终 overview.png；结果位于 `artifacts/ui-check/changed-N2mYg7/`。两端 typecheck 均为 0 错误，上一节全量结果包含本次布局。

统一身份提交为 `d5c6b16d`；本节布局另作独立提交。整个 B7 保持不 push。
