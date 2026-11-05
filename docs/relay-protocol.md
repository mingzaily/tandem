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

地址：`wss://<域名>/ws`。健康检查：`GET /healthz` 返回 `{"ok":true,"v":1}`。

### 连接

第一帧必须在 10 秒内到达。

```jsonc
// 桌面端。token 是部署时配置的 TANDEM_RELAY_HOST_TOKEN
{"t":"host-hello","v":1,"room":"<b64 16字节>","token":"<部署令牌>"}
// 手机。token 是客户端令牌，配对时用配对令牌
{"t":"client-hello","v":1,"room":"<b64 16字节>","token":"<b64 32字节>"}
// 中转回复
{"t":"hello-ack","conn":"<连接号>","hostOnline":true}
```

部署令牌比较要用定时安全比较。

### 准入令牌

中转只保存令牌的 SHA-256（小写十六进制），不保存原文。

```jsonc
// 桌面端 → 中转
{"t":"allow","tokenHash":"<hex>","oneTime":true,"expiresAt":1790000000000} // 配对令牌，5 分钟
{"t":"allow","tokenHash":"<hex>","oneTime":false,"expiresAt":null}         // 客户端令牌
{"t":"revoke","tokenHash":"<hex>"}                                         // 同时断开用它连接的手机
```

`oneTime` 的令牌在第一次连接成功时作废。长期令牌写入磁盘，配对令牌只在内存里。桌面端重连后重发自己持有的全部长期令牌，中转以此为准，其余的删掉，所以需要一条 `{"t":"allow-sync","tokenHashes":["<hex>"]}`。

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

其他关闭码：`4400` 版本不符，`4401` 准入失败或超时，`4409` 同房间新的桌面端顶替旧连接，`4410` 令牌被撤销（手机不再重连）。

中转日志只记连接事件和错误码，不记令牌和 `d`。

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

`clientId` 未知、已撤销或签名不对时断开这条逻辑连接。握手完成前，桌面端不处理任何操作。

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
| `host.info` | 无 | `{name, version, agents: Agent[], projects: {cwd, name}[]}` |
| `tasks.list` | 无 | `{tasks: TaskSummary[], external: {taskId, isBusy}[]}`，不含已归档任务 |
| `task.read` | `{agent, id, before?: number, limit?: number}` | `{messages: Message[], context, total: number}` |
| `agent.info` | `{agent}` | `{models: ModelOption[], usage: UsageWindows \| null}` |
| `turn.send` | `{agent, taskId: string \| null, cwd: string \| null, prompt, model, effort, permissionMode}` | `{runId}`，随后是事件 |
| `turn.cancel` | `{taskId}` | `{}` |
| `request.answer` | `{taskId, requestId, decision: Decision}` | `{}` |
| `live.snapshot` | 无 | `{seq: number, runs: Run[]}` |

```ts
interface Run {
  runId: string;
  taskId: string | null;   // 新任务在 started 事件之前是 null
  agent: Agent;
  /** 本轮到目前为止的事件，手机重连后据此补齐。 */
  events: TurnEvent[];
}
```

- `task.read` 从末尾倒着分页：`before` 是消息序号的上界（不含），默认总数；`limit` 默认 200，上限 500。`Message.image` 在 v1 里不传，改成 `image: "omitted"`，页面显示“图片”占位。
- `seq` 由桌面端全局递增。快照里的 `seq` 是取快照那一刻的值，手机丢弃 `seq` 不大于它的事件，等快照期间到达的更大的事件要留到快照之后再应用，这样不重也不漏。
- 桌面端和手机同时看到同一轮：不论轮次从哪边发起，事件都推给所有已握手的手机，桌面界面也同步显示。

事件：

| 事件 | 内容 |
|---|---|
| `turn.event` | `{runId, taskId, seq: number, event: TurnEvent}` |
| `tasks.changed` | 无。手机重新取 `tasks.list` |

## 8. PWA 范围

第一版：配对（粘贴、相机扫码）、任务列表（按项目分组）、读任务、发消息和新建任务（模型、强度、权限）、停止、确认和提问卡片、断线重连和补齐、撤销后的提示。

不做：推送通知、附件和图片发送、设置同步。消息内容不写入持久存储，只保存配对信息；Service Worker 只缓存应用外壳。

视觉使用 `desktop/design/tokens/`。

## 9. 演进

`v` 不同就拒绝连接。新增操作和字段向后兼容，不改 `v`；收到不认识的操作回 `BAD_REQUEST`，收到不认识的事件和字段就忽略。
