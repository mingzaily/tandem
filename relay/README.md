# Tandem Relay

独立的 Rust 中转，使用 Tokio、axum 与 tungstenite，接口依据[中转协议 v1](../docs/relay-protocol.md)。中转负责准入、转发密文和上下线通知，日志只记录连接事件与错误码。运行时只需一个二进制，依赖树包含零个 TLS 库。

## 本地开发

需要 Rust 1.91+；PWA 和开发工具使用 Node 24、pnpm 10。

```sh
cd relay
cargo build --locked
TANDEM_RELAY_HOST_TOKEN=development-only cargo run --locked
```

另一个终端启动开发工具：

```sh
cd relay
pnpm install
TANDEM_RELAY_HOST_TOKEN=development-only pnpm fake-host
```

fake-host 输出一次性配对码，自动允许六位确认码，提供项目分组、三种 Agent、Markdown、工作过程、分页、新建任务、确认、提问、停止与重连快照。它只用于本机演示，身份与任务随进程退出消失。开发工具位于 `dev/`，TypeScript 服务端已移除，生产镜像只包含 Rust 二进制和构建后的 PWA。

```sh
cargo test --locked
cargo clippy --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` 先编译 Rust，再在临时端口、临时数据文件上运行协议测试，通过真实 WebSocket 和 PWA 协议层验证。`dev/rust-relay.ts` 只负责启动及关闭编译好的二进制；生产运行使用 `target/release/tandem-relay`。测试覆盖原 Node 版的所有场景，并验证帧头限额、全局连接上限、代理地址、可选准入确认及逻辑连接关闭。Rust 单元测试验证令牌编码、有效期、积压计数、代理取址及持久化失败恢复。

PWA 浏览器测试：在 `pwa/` 运行 `SHOTS=/绝对路径/pwa- pnpm test:browser`，使用无头 Chrome 测试两种尺寸和两种主题。密码学固定向量可用 `pnpm exec tsx dev/generate-vectors.ts` 重新生成。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `TANDEM_RELAY_HOST_TOKEN` | 必填 | 随机部署令牌，与桌面端相同，使用固定长度摘要的定时安全比较 |
| `TANDEM_RELAY_DATA_FILE` | `./data/tokens.json` | 长期准入令牌 SHA-256 与房间映射 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8787` | HTTP 和 WebSocket 共用端口，`0` 用于测试临时端口 |
| `TANDEM_RELAY_TRUST_PROXY` | 关闭 | 恰好为 `1` 时采用 `X-Forwarded-For` 最后一段；其余情况使用 socket 地址 |
| `TANDEM_RELAY_STATIC_DIR` | 关闭 | 可选 PWA 构建目录，容器为 `/pwa` |

客户端令牌先按 base64url 解码为 32 字节，再计算小写十六进制 SHA-256，绑定房间。配对令牌只在内存中保留，最多五分钟，首次成功连接后失效。长期令牌的文件格式兼容 Node 版：

```json
[["<64 位小写 SHA-256>", {"room":"<16 字节 base64url>","oneTime":false,"expiresAt":null}]]
```

迁移时停掉旧服务，挂载原 `tokens.json`，启动 Rust 版。文件只保存哈希和房间。独占数据目录、单实例运行；串行写入使用同目录临时文件、同步落盘和 rename，文件权限 `0600`。本次写入失败会关闭发起连接，队列继续处理之后的写入。桌面端每次重连先重登记全部长期令牌哈希，确认落盘后再通过 `allow-sync` 校准，准入文件丢失也能恢复。

## Docker Compose

从仓库根目录构建：

```sh
docker build -f relay/Dockerfile -t tandem-relay:local .
```

多阶段构建使用 Node 构建 PWA、Rust/musl 构建静态二进制。最终使用 scratch 镜像，以 UID/GID `65532` 运行，包含二进制、PWA 和 `/licenses/` 中的 LICENSE / NOTICE，没有 Node、nginx、证书或 TLS。`relay/Dockerfile.dockerignore` 将构建上下文限制到源码和设计 token。

部署时使用[compose.yaml](./compose.yaml)，在同目录的 `.env` 设置随机的 `TANDEM_RELAY_HOST_TOKEN`。默认镜像地址为 `ghcr.io/mingzaily/tandem-relay:latest`，relay 及镜像依赖改动进入 `main` 后自动发布，首次使用需要该工作流成功。也可将 compose 的 image 换为本地构建的 tag。

```sh
cd relay
docker compose up -d
docker compose exec relay /tandem-relay healthcheck
curl http://127.0.0.1:8787/healthz
```

健康接口返回 `{"ok":true,"v":1}`，PWA 入口是 `/`，WebSocket 是 `/ws`。镜像内置健康检查子命令，无需 curl。命名卷 `/data` 保存准入文件；绑定宿主目录时，将所有者设为 `65532:65532`。SIGINT/SIGTERM 会关闭 HTTP 和所有 WebSocket，完成已排队的写入后退出。

容器内部使用 HTTP 和 WS；网关对外提供 HTTPS 和 WSS。WebCrypto 要求安全上下文，桌面端也只接受本机地址的 `ws://`。反向代理应转发 WebSocket 升级头，读超时大于 90 秒。只有入口受保护并正确传递来源地址时，才启用 `TANDEM_RELAY_TRUST_PROXY=1`。[用户文档](../site/src/guide/proxy.md)提供 nginx 和 Caddy 完整配置。

`.github/workflows/relay-image.yml` 在 relay、镜像内 PWA / 共享 token 及构建工具改动进入 `main` 后自动触发，手动执行也只接受 `main`。CI 使用北京时间生成独立的 `major.minor.YYYYMMDDNN`，预留 `relay-v<版本>` tag；同提交重跑复用版本和已经发布的完整双架构镜像。先运行共享验证，再启动 amd64 待发布镜像完成健康检查、PWA 配对、数据持久化及退出验收，成功后构建并发布 `linux/amd64` 与 `linux/arm64`，生成同名版本标签与 SHA 标签，并在高于当前版本时串行晋升 `latest`。桌面端使用自己的 `v<版本>` 命名空间，两者规则相同、序号各自递增。

日期版本同步写入构建工作区的 Cargo.toml / Cargo.lock，二进制通过 `/healthz.version` 和 `hello-ack.relayVersion` 自报。桌面“设置 → 远程 → 中转服务”连接后显示该版本，与桌面应用版本分别呈现。文档站发布配置位于 `.github/workflows/site-pages.yml`，目标入口为 `https://mingzaily.github.io/tandem/guide/`。

PR 和 main 的相关改动由 `.github/workflows/ci.yml` 自动验证。本地在仓库根目录运行 `node .github/scripts/verify.mjs --image`，使用同一套检查且不推送；完整命令、依赖和验证边界见 [CI 与本地验证](../docs/dev-rules/ci-validation.md)。

## 可选静态托管

```sh
cd pwa
pnpm install
pnpm build
# Return to relay and set TANDEM_RELAY_STATIC_DIR to the absolute pwa/dist path.
```

中转直接托管构建目录，保留 `index.html` 的 CSP，设置 `nosniff` 与 `Cache-Control: no-cache`。Service Worker 只缓存固定外壳资源，不缓存任务内容与网络响应。也可独立托管 PWA；本地不设置静态目录时，只提供健康检查与 WebSocket。

公共手机端由官网的 `/tandem/app/` 提供，连接配对码中的用户自建中转。官网、手机端与中转保留独立的源码和构建；Docker 镜像继续附带根路径版本，供用户选择自托管页面。

## 真实桌面端互通

在已有调试版的 macOS 上运行 `pnpm interop`。`dev/real-desktop.mts` 启动隔离测试、驱动页面并调用 `dev/desktop-interop.mts`；也可通过 `TANDEM_DESKTOP_TEST_BINARY` 指定调试版二进制。

`dev/desktop-interop.mts` 通过 PWA 协议层驱动调试版桌面端。使用临时数据和替身 CLI，通过 `ZDOTDIR` 选择替身 PATH，配合 `TANDEM_DRIVE_PAIR_FILE` 与 `TANDEM_DRIVE_PAIR_ALLOW=1`。遵循 [Desktop 开发规则](../docs/dev-rules/desktop-development.md)，测试前确认应用数据目录中 `remote.json` 尚未存在，结束后删除本次测试创建的文件，并恢复页面 localStorage。

桌面端与 fake-host 均使用 `allow.id → allow-ack`，在确认后展示配对码或发送 `pair4`；确认等待上限为 10 秒，取消后的迟到确认会清理对应令牌。桌面端使用 `disconnect.conn` 关闭校验失败的手机连接，其他会话继续工作。

`disconnect.code` 区分两种情况：`4411` 结束本次异常会话，`4410` 表示客户端未配对或已撤销；省略时使用 `4411`。长期准入令牌由 `revoke` 撤销。已配对 PWA 对 `4411` 和限额关闭 `4429` 按 1.5 秒起、最大 30 秒的指数退避重连；`4400`、`4401` 为需处理的协议／准入错误，`4410` 提示重新配对。配对的单次尝试和最终回复先于关闭帧的顺序分别验证。fake-host 支持 `disconnectFirstHandshake` 注入一次握手断连，用于验证自动重连后继续加密通信。

准入文件损坏时启动失败，日志包含文件路径与恢复方法。可从备份恢复，或将损坏文件移到备份位置后重启；桌面端重新连接后会恢复长期准入。日志中的令牌与任务内容保持保密。

配对使用 `ttlMs: 300000`，中转以自己的时钟计期，桌面端以单调时钟管理配对生命周期。原有 `expiresAt` 登记仍按五分钟上限接受。运行快照和事件包含开始时间与单调计时的已运行时长，PWA 重连后延续用时。

真实桌面测试还通过 `dev/grant-proxy.ts` 延迟及丢弃确认，验证确认前隐藏配对码、确认超时、取消后的迟到确认、`pair4` 顺序、违规逻辑连接关闭、删除准入文件后的重登记与运行计时恢复。

首次发布的 GHCR 包默认私有；公开包支持匿名拉取，私有包需要先执行 `docker login ghcr.io`。详情见 [GitHub Container registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。本次验收结果与截图索引见 [VERIFICATION.md](./VERIFICATION.md)。
