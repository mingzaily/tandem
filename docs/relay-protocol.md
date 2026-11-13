# 中转协议 v1

桌面端、中转、手机 PWA 三方共同遵守的接口。改这份文档要同时改三方。

## 1. 结构

```
手机 PWA ──WSS──▶ 中转 ◀──WSS── 桌面端（host）
   └────── 端到端加密的内容 ──────┘
```

- 桌面端和手机都主动连中转，桌面端不开放任何端口。
- 中转只做三件事：核对准入令牌、按房间转发、报告上下线。它看不到任务内容，也解不开。
- 一个房间对应一台桌面端，可以配对多台手机。
- 远程功能默认关闭，用户在设置里打开并配对后才连接。

## 2. 安全边界

中转和网络都按不可信处理。安全只依赖端到端层（第 5、6 节），准入令牌只用来挡滥用。

手机能做的事只有第 7 节列出的操作。桌面端还要守住这些：

- **权限：** 手机和电脑可选的权限相同，包括完全访问。这是用户的决定：手机丢失时在电脑上撤销它。
- **目录：** 新任务的 `cwd` 必须是桌面端已添加的项目，或对话目录。
- **单写入者：** 任务开在别处时拒绝发送。手机没有“仍要发送”。
- **不暴露：** 安装和登录 CLI、读取任意文件、改设置、管理配对设备。
- **撤销：** 桌面端撤销一台手机后立刻断开它，并让它的令牌失效。

## 3. 编码约定

- 帧是 WebSocket 文本帧，内容是 JSON。
- 二进制字段用不带填充的 base64url，记作 `b64`。
- 所有密码学都能用 WebCrypto 实现：P-256、ECDH、ECDSA-SHA256、HKDF-SHA256、HMAC-SHA256、AES-256-GCM。
- 公钥是未压缩点（65 字节）。ECDSA 签名是 `r||s`（64 字节）。
- 下面的 `||` 是字节拼接，字符串按 UTF-8。公钥和令牌在拼接时用原始字节，不用 base64url。

## 4. 中转层

地址：`wss://<域名>/ws`。健康检查：`GET /healthz` 返回 `{"ok":true,"v":1,"version":"<relay 产品版本>"}`。`v` 是通信协议版本，`version` 是 CI 写入二进制的独立发布版本。

### 连接

第一帧必须在 10 秒内到达。

```jsonc
// 桌面端。token 是部署时配置的 TANDEM_RELAY_HOST_TOKEN
{"t":"host-hello","v":1,"room":"<b64 16字节>","token":"<部署令牌>"}
// 手机。token 是客户端令牌，配对时用配对令牌
{"t":"client-hello","v":1,"room":"<b64 16字节>","token":"<b64 32字节>"}
// 中转回复
{"t":"hello-ack","conn":"<连接号>","hostOnline":true,"relayVersion":"0.1.2026111101"}
```

`relayVersion` 是可选的服务端产品版本，仅供桌面“中转服务”展示，不参与协议兼容判断。旧中转省略该字段时连接语义保持原样，桌面显示“当前中转未提供版本”；断开后清除版本读数。桌面与 relay 的日期版本各自分配，通信协议继续使用 `v: 1`。

部署令牌比较要用定时安全比较。

### 准入令牌

中转只保存令牌的 SHA-256（小写十六进制），不保存原文。

```jsonc
// 桌面端 → 中转
{"t":"allow","tokenHash":"<hex>","oneTime":true,"ttlMs":300000}          // 配对令牌，5 分钟
{"t":"allow","tokenHash":"<hex>","oneTime":false,"expiresAt":null}         // 客户端令牌
{"t":"revoke","tokenHash":"<hex>"}                                         // 同时断开用它连接的手机
```

配对令牌的 `ttlMs` 是 1 到 300000 的整数，由中转接收登记时的自身时钟计算到期时间。桌面端从发起登记起用单调时钟计算五分钟期限，收到确认后才展示，期限包含等待确认的时间。两端系统时钟的差值因此不参与有效期判断。原有 `expiresAt` 形式继续接受，要求 `now < expiresAt ≤ now + 300000`；一条配对登记恰好提供 `ttlMs` 或 `expiresAt` 中的一项。

`oneTime` 的令牌在第一次连接成功时作废。长期令牌写入磁盘，配对令牌只在内存里。桌面端每次重连都先逐个 `allow` 重登记已配对设备的全部长期令牌哈希，等全部 `allow-ack` 后发送 `{"t":"allow-sync","tokenHashes":["<hex>"]}` 并进入在线状态。`allow-sync` 删除当前房间清单之外的长期令牌，保留配对令牌；增加令牌由前面的 `allow` 完成。中转准入文件丢失时，桌面端持有的哈希可恢复长期准入。

### 准入确认（可选扩展）

桌面端可以为 `allow` 增加 `id`（1 到 128 字节的字符串），请求确认：

```jsonc
{"t":"allow","id":"grant-1","tokenHash":"<hex>","oneTime":false,"expiresAt":null}
{"t":"allow-ack","id":"grant-1"} // Relay -> desktop
```

配对令牌登记到内存后确认，长期令牌原子落盘后确认。写入失败时中转记录准入文件路径和系统报错，关闭本条桌面连接（`1011`），后续连接的写入仍可执行。桌面端收到确认后再展示配对码或发送 `pair4`，保证手机拿到令牌时准入已就绪。`allow` 省略 `id` 时保持原语义，中转省略确认回复。

桌面端每笔登记等待确认至多 10 秒，超时或连接关闭时结束本次配对并重新连接中转。取消或替换配对后到达的确认只清理对应令牌。长期准入确认后，桌面端先保存设备公钥与令牌哈希，再发送 `pair4`；保存失败会结束本条桌面连接，重连时按已保存的设备清单校准中转。

### 关闭逻辑连接（可选扩展）

```jsonc
// Desktop -> relay: close a phone connection in its own room.
{"t":"disconnect","conn":"<连接号>","code":4411}
```

中转只处理该桌面端房间中的手机连接，按 `code` 关闭，并发送 `peer online:false`。`code` 只接受 `4411`、`4410`，省略时为 `4411`：

- `4411` 表示本次会话被断开，可以重连。签名、密文、消息顺序等校验失败时使用此码。
- `4410` 表示客户端身份未配对或已撤销，手机停止重连并提示重新配对。桌面端在握手时识别未知身份，或撤销已建立／正在握手的设备连接时使用此码。

连接号已离线或属于其他房间时完成空操作。`disconnect` 只关闭连接，准入令牌的撤销由 `revoke` 完成。

桌面端与开发 fake-host 均使用这两项扩展。桌面端通过 `disconnect.conn` 指定连接、`disconnect.code` 区分断开原因，中转校验关闭码并执行。配对的成功回复或拒绝消息先于关闭帧发送。

已配对的 PWA 会话收到 `4411` 或 `4429` 后保留身份并自动重连。重试从 1.5 秒开始翻倍，最大间隔 30 秒；加密握手成功后重置间隔。每次重连使用新的连接和握手密钥，已发送操作继续按“结果未知”处理。

配对连接按单次尝试处理，关闭后由用户重新发起。已接收的 `pair4` 完成解密后再判定配对结果，`4410` 或 `4411` 收尾关闭都保留已完成的配对结果；配对阶段使用的一次性令牌不自动重试。

### 转发

```jsonc
// 手机 → 中转 → 桌面端。from 由中转填写，手机填的会被覆盖
{"t":"data","d":"<b64>"}               →  {"t":"data","from":"<连接号>","d":"<b64>"}
// 桌面端 → 中转 → 手机。to 必填
{"t":"data","to":"<连接号>","d":"<b64>"} →  {"t":"data","d":"<b64>"}
// 上下线通知
{"t":"peer","conn":"<连接号>","online":false}   // 发给桌面端
{"t":"host","online":true}                      // 发给手机
{"t":"error","code":"HOST_OFFLINE"}             // 发给发送方
```

桌面端 `data.to` 必须是连接号字符串，省略时以 `4400` 关闭；转发目标限定为当前房间的手机。

### 限制

| 项 | 值 | 超出时 |
|---|---|---|
| 单帧 | 2 MiB | 回 `PAYLOAD_TOO_LARGE`，不断开；超过 4 MiB 直接关闭，`1009` |
| 准入前的帧 | 4 KiB | 按准入失败处理 |
| 接收方积压 | 16 MiB | 关闭，`1013` |
| 每房间手机连接 | 8 | 关闭，`4429` |
| 全部连接 | 256 | 关闭，`4429` |
| 同一 IP 准入失败 | 每分钟 10 次 | 关闭，`4429` |
| 空闲 | 每 30 秒 ping，90 秒无响应 | 关闭 |

其他关闭码：`4400` 版本不符或中转帧格式错误，`4401` 准入失败或超时，`4409` 同房间新的桌面端顶替旧连接，`4410` 客户端身份未配对或令牌被撤销，`4411` 本次手机会话被断开。已配对 PWA 对 `4400`、`4401` 停止重试并提示检查协议版本与配对信息，对 `4410` 停止重连、清除本机配对身份并提示重新配对；`4411` 与连接／准入限额 `4429` 使用上述退避策略。

准入前按帧头限制 4 KiB，超过即记一次准入失败。准入后，4 MiB 硬上限在读取正文前校验；2 MiB 到 4 MiB 之间回复错误并保留连接。分片消息的总长度也受对应的消息上限约束。

`TANDEM_RELAY_TRUST_PROXY=1` 时采用 `X-Forwarded-For` 最后一段作为来源地址；其余情况下采用 socket 对端地址。代理负责写入可信地址，并保护中转内部端口。

中转运行日志记录连接事件和错误码。启动时准入文件损坏会记录文件路径及恢复方法。日志保留令牌和 `d` 的保密边界。

## 5. 配对

桌面端生成配对码，用户在 PWA 里粘贴或扫描：

```
tandem-pair:<b64 JSON>
{"v":1,"relay":"wss://...","room":"<b64>","host":"<b64 桌面端签名公钥 S_h>","token":"<b64 32字节 配对令牌>","secret":"<b64 32字节 配对密钥>"}
```

配对码不用链接形式：iOS 主屏幕 PWA 和 Safari 不共享存储，在 Safari 里打开链接配对的结果带不进 PWA。`secret` 不发给中转。

手机生成长期签名密钥 `S_c`（不可导出，存 IndexedDB）和临时 ECDH 密钥 `E_c`。以下消息是 `data.d` 解码后的 JSON：

```jsonc
C→H {"k":"pair1","e":"<E_c>","s":"<S_c>","name":"iPhone"}
H→C {"k":"pair2","e":"<E_h>","mac":"<macH>"}
C→H {"k":"pair3","mac":"<macC>","sig":"<S_c 对 th 的签名>"}
H→C {"k":"pair4","c":"<AES-GCM 密文>"}   // 用户允许后
H→C {"k":"pair-denied"}                  // 用户拒绝、超时或校验失败
```

计算：

```
th   = SHA-256("tandem-pair-v1" || E_c || S_c || E_h || S_h)
okm  = HKDF(ikm=ECDH(E_c,E_h), salt=secret, info="tandem-pair-v1"||th, 96字节)
macH = HMAC(okm[0..32],  "host"||th)
macC = HMAC(okm[32..64], "client"||th)
aes  = okm[64..96]
code = (th 前 4 字节按大端读成 uint32) mod 1000000，补零到 6 位
```

- 手机先校验 `macH`，桌面端校验 `macC` 和 `sig`。任何一步失败都发 `pair-denied`，配对码作废。
- 两边都显示 `code`。桌面端弹窗显示设备名和 `code`，用户点“允许”才继续。
- `pair4` 的明文是 `{"clientId":"<b64 16字节>","token":"<b64 32字节 客户端令牌>"}`，AES-GCM 的 nonce 为 12 个零字节，AAD 为 `"tandem-pair4"`。
- 桌面端保存 `clientId`、`S_c`、设备名和配对时间，发 `allow` 登记客户端令牌。手机保存 `relay`、`room`、`S_h`、`clientId`、令牌，然后断开，用客户端令牌重连。

## 6. 会话

每次连接都重新握手。

```jsonc
C→H {"k":"hello1","v":1,"clientId":"<b64>","e":"<E_c>"}
H→C {"k":"hello2","e":"<E_h>","sig":"<S_h 签名>"}
C→H {"k":"hello3","sig":"<S_c 签名>"}
```

```
th      = SHA-256("tandem-session-v1" || clientId || E_c || E_h || S_c || S_h)
hello2.sig 签的是 "host"||th，hello3.sig 签的是 "client"||th
okm     = HKDF(ikm=ECDH(E_c,E_h), salt=th, info="tandem-session-v1", 64字节)
c2h = okm[0..32]，h2c = okm[32..64]
```

`clientId` 未知或已撤销时以 `4410` 断开；签名、计数器、密文或握手顺序校验失败时以 `4411` 断开。握手完成前，桌面端不处理任何操作。

握手后的消息：

```jsonc
{"k":"m","n":0,"c":"<b64 AES-GCM 密文>"}
```

- nonce 是 4 个零字节加 `n` 的 8 字节大端。AAD 是 `"tandem-m-v1"`。
- 每个方向的 `n` 从 0 开始，必须严格加 1，否则断开。解密失败同样断开。
- 明文第一个字节是 `0`（结束）或 `1`（后面还有），其余是 JSON 的 UTF-8 片段。发送方按 512 KiB 分片，接收方重组上限 32 MiB。

## 7. 操作

请求和回复：

```jsonc
{"id":1,"op":"tasks.list","p":{}}
{"id":1,"ok":true,"r":{}}
{"id":1,"ok":false,"e":{"code":"NOT_ALLOWED","message":"..."}}
{"ev":"turn.event","p":{}}   // 事件，没有 id
```

错误码：`BAD_REQUEST`、`NOT_ALLOWED`、`NOT_FOUND`、`BUSY_ELSEWHERE`、`INTERNAL`。

下面的类型和 `desktop/src/lib/api.ts` 一致（`Agent`、`TaskSummary`、`Message`、`TaskContext`、`TurnEvent`、`Decision`、`Question`、`ModelOption`、`UsageWindows`）。

| 操作 | 参数 | 结果 |
|---|---|---|
| `host.info` | 无 | `{name, version, agents: Agent[], projects: {cwd, name}[], conversationRoots: string[]}` |
| `tasks.list` | 无 | `{tasks: TaskSummary[], external: {taskId, isBusy}[]}`，不含已归档任务 |
| `task.read` | `{agent, id, before?: number, limit?: number}` | `{messages: Message[], context, modelSelection: {model, effort} \| null, permissionMode: string \| null, total: number}` |
| `agent.info` | `{agent}` | `{models: ModelOption[], usage: UsageWindows \| null}` |
| `turn.send` | `{agent, taskId: string \| null, cwd: string \| null, prompt, model, effort, permissionMode}` | `{runId}`，随后是事件 |
| `turn.cancel` | `{taskId}` | `{}` |
| `request.answer` | `{taskId, requestId, decision: Decision}` | `{}` |
| `live.snapshot` | 无 | `{seq: number, runs: Run[]}` |

`host.info.projects` 包含已添加的项目及 `cwd: "tandem:conversation"` 的“对话”入口，按电脑侧栏保存的拖动顺序返回；尚未保存位置的项目放在已排序项目之前。页面通过 `remote_update_context` 的 `context.projectOrder` 将 localStorage 中的项目顺序传给后端。

`conversationRoots` 包含当前与历史对话工作区。手机按目录边界匹配：任务目录等于根目录或位于根目录的子目录时，统一归入 `tandem:conversation` 分组。其他任务匹配最具体的项目目录；分组顺序沿用 `projects`，分组内按更新时间倒序。

```ts
interface Run {
  runId: string;
  taskId: string | null;   // 新任务在 started 事件之前是 null
  agent: Agent;
  prompt: string;         // 本轮原始输入，用于合并原生历史与实时进展
  startedAtMs: number;    // 桌面端记录的 Unix 毫秒开始时间
  elapsedMs: number;      // 单调时钟计算的已运行时长
  /** 本轮到目前为止的事件，手机重连后据此补齐。 */
  events: TurnEvent[];
}
```

- `task.read` 从末尾倒着分页：`before` 是消息序号的上界（不含），默认总数；`limit` 默认 200，上限 500。`Message.image` 在 v1 里不传，改成 `image: "omitted"`，页面显示“图片”占位。
- 终态失败归一化为 `Message.kind: assistant`、`isError: true`，`text` 保存原始错误详情；工具失败继续使用 `tool_result`，与轮次失败分别呈现。手机在所属轮次结尾显示摘要和可展开详情，保留到后续轮次。
- `task.read.modelSelection` 使用各 CLI 原生记录的模型 ID 和强度，`permissionMode` 使用原生记录的权限模式；手机按任务恢复选择，模型列表的读取与新建页默认值各自独立。旧版本桌面端缺少这些字段时，手机从 `context.model` 恢复已知模型，其余选项交给 CLI 决定。
- `seq` 由桌面端全局递增。快照里的 `seq` 是取快照那一刻的值，手机合并已包含的事件，等快照期间到达的更大的事件在快照后应用。缓冲中已结束且快照已移除的轮次继续处理其结束事件，保留失败和中断结果。新握手重新建立序号边界，迟到的旧连接结果保持隔离；`runId` 使用每轮独立的 UUID，桌面重启后继续保持唯一。
- `Question.question` 保留原生完整问题并作为 `Decision.answer.answers` 的键。可选的 `displayQuestion` 与 `context` 分别用于主问题和背景说明的展示；字段省略时直接显示 `question`。Pi 的固定 `Context:` 拼接在宿主归一化，旧客户端仍可按完整 `question` 显示和回答。
- 提问中的 `Question.allowCustom` 控制页面自定义入口：省略时允许；有选项时点击入口后展开输入框，“返回选项”或 Esc 回到选择入口并保留草稿，纯输入题直接显示。Claude 沿用默认行为，Codex 从原生 `isOther` 映射。Pi 普通 `select` 为 `false`；`pi-ask-user` 固定的自定义选项转换为 `allowCustom: true` 与本地化入口。`Decision` 的 `answer` 可带可选 `custom: boolean`（默认 `false`），表示答案来自自由输入；宿主在 Pi 自定义场景桥接原生选择与紧随输入，其他 CLI 沿用原始答案字段。
- 提问可带 `Question.allowComment?: boolean`，表示预设选择后允许先填写可选备注，返回选项仍保持请求等待。`Decision.answer` 可带 `comment?: string`；Pi 宿主将选择和备注桥接到原生连续对话，空备注保留选择，旧客户端省略字段时按空备注完成原生后续步骤。选项描述、多选和备注能力由正在执行的 `ask_user` 参数补齐，原始问题键继续保留。
- 已回答摘要从实际工具输入与结果提取。Pi 的 `ask_user` 结果文本可包含其原生结构化 `details` JSON，页面优先读取 `question/response` 或批次 `questions/answers`；通用工具保持原文本显示，历史文件不由页面改写。
- `prompt` 保存在本轮内存快照中，消息流据此识别历史文件里已包含的当前提示词。实时 `started` 和 `finished` 帧携带 `prompt`；其他增量保持紧凑。事件始终携带实际执行的 `agent`。已知任务在启动 CLI 前就登记 `taskId`，启动失败也能归到正确任务。
- 快照和实时事件使用同一个 `startedAtMs`；`elapsedMs` 在各自生成时取值。手机用收到的 `elapsedMs` 与本机单调时钟延续计时，重连后保持已运行时长，手机和桌面端的系统时间可以不同。
- 桌面端和手机同时看到同一轮：不论轮次从哪边发起，事件都推给所有已握手的手机，桌面界面也同步显示。

事件：

| 事件 | 内容 |
|---|---|
| `turn.event` | `{runId, taskId, agent, prompt?: string, startedAtMs, elapsedMs, seq: number, event: TurnEvent}`，`prompt` 随开始和结束事件发送 |
| `tasks.changed` | 无。任务或页面上下文变化后，手机重新取 `tasks.list` 和 `host.info`，更新目录分组与项目顺序 |

`TurnEvent` 新增展示事件 `generationSpeed`，内容为 `{speed: {rate: number | null, average: number | null, peak: number | null, generationMs: number, measuredTokens: number, streaming: boolean}}`。它将真实 usage 校准后的速度与主机计时成对传递；`measuredTokens` 是参与计速的校准份额，累计输出仍取 `outputTokens.total`。手机端当前保留协议类型并忽略该展示事件，消息合并与提问状态沿用原处理。

`TurnEvent` 新增展示事件 `background`，内容为 `{tasks: number, idle: boolean}`，表示 Claude 仍在运行的后台任务数，`idle` 为真时 Agent 已回复、只在等待后台任务。这段时间这一轮尚未结束，`finished` 在后台任务清空、CLI 完成最后一轮汇报后才发出。手机端忽略该事件，运行状态保持不变。

## 8. PWA 范围

第一版：配对（粘贴、相机扫码）、任务列表（按项目分组）、读任务、发消息和新建任务（模型、强度、权限）、停止、确认和提问卡片、断线重连和补齐、撤销后的提示。

不做：推送通知、附件和图片发送、设置同步。消息内容不写入持久存储，只保存配对信息；Service Worker 只缓存应用外壳。

视觉使用 `desktop/design/tokens/`。

## 9. 演进

`v` 不同就拒绝连接。新增操作和字段向后兼容，不改 `v`；收到不认识的操作回 `BAD_REQUEST`，收到不认识的事件和字段就忽略。
