# Tandem Relay

Node 24、TypeScript、ws 实现的单进程中转，接口依据 [中转协议 v1](../docs/relay-protocol.md)。只验证准入、转发密文、发送上下线通知。日志只有连接事件及错误码。

## 本地开发和验证

```sh
cd relay
pnpm install --store-dir .pnpm-store
pnpm typecheck
pnpm test
pnpm build
TANDEM_RELAY_HOST_TOKEN=development-only pnpm dev
```

另一个终端启动开发桌面端：

```sh
cd relay
TANDEM_RELAY_HOST_TOKEN=development-only pnpm fake-host
```

将输出的配对码粘贴到 PWA。fake-host 提供项目 `/demo`、三种 Agent、任务历史、分页、新建任务、流式事件、确认、提问、停止和重连快照。开发工具自动允许核对码，只用于演示。进程退出后设备身份和任务消失。Ctrl-C 关闭这两个进程。

`pnpm test` 在临时端口启动真实 relay 和 fake-host，通过 PWA 协议层完成配对、重连、读写任务、确认、提问和撤销，测试结束关闭全部 socket、HTTP 服务及定时器。测试不读取用户任务或 CLI 配置。PWA 的协议实现只被开发工具和测试使用，生产中转独立构建。

`pnpm exec tsx dev/generate-vectors.ts` 使用 WebCrypto 和 node:crypto 重新生成固定向量。ECDSA 测试签名固定私钥及 nonce；生产签名由 WebCrypto 生成。固定测试密钥只用于互操作测试。

## 环境变量和数据

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `TANDEM_RELAY_HOST_TOKEN` | 必填 | 部署令牌，生成足够长的随机值，桌面端使用同一值 |
| `TANDEM_RELAY_DATA_FILE` | `./data/tokens.json` | 长期令牌 SHA-256、房间映射的 JSON 文件 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8787` | HTTP / WebSocket 端口 |
| `TANDEM_RELAY_TRUST_PROXY` | 不设置 | 在 nginx、caddy 后面时设成 `1`，并让代理设置 `X-Forwarded-For`，准入失败才能按真实地址限流。直接暴露到公网时不要设置，否则地址可以伪造 |

令牌文件使用 0600 权限，以临时文件加 rename 原子更新，写入串行执行。配对令牌在内存中存活最多五分钟。请给进程独占数据目录并持久挂载；单实例运行。重启后加载长期令牌，桌面端通过 allow-sync 校准。准入失败和日志均不输出令牌、密文或任务。

检查健康：`curl http://127.0.0.1:8787/healthz`。返回 `{"ok":true,"v":1}`。

## systemd 部署

部署 relay 目录，安装依赖后运行 `pnpm build`。将以下服务保存为 `/etc/systemd/system/tandem-relay.service`：

```ini
[Unit]
Description=Tandem Relay
After=network.target

[Service]
Type=simple
User=tandem
WorkingDirectory=/opt/tandem/relay
EnvironmentFile=/etc/tandem-relay.env
ExecStart=/usr/bin/node /opt/tandem/relay/dist/index.js
Restart=on-failure
UMask=0077
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/tandem-relay

[Install]
WantedBy=multi-user.target
```

创建专用用户及其可写的 `/var/lib/tandem-relay`。环境文件由管理员以 0600 保存：

```dotenv
TANDEM_RELAY_HOST_TOKEN=替换为随机部署令牌
TANDEM_RELAY_DATA_FILE=/var/lib/tandem-relay/tokens.json
HOST=127.0.0.1
PORT=8787
```

确认 Node 路径指向 Node 24，执行 `systemctl daemon-reload` 和 `systemctl enable --now tandem-relay`。使用 `systemctl stop tandem-relay` 停止；SIGTERM 会关闭服务、连接和定时器并等待落盘。

## TLS 和可选静态托管

推荐 Caddy 自动终止 TLS；替换域名后使用：

```caddyfile
relay.example.com {
    @relay path /ws /healthz
    handle @relay {
        reverse_proxy 127.0.0.1:8787
    }
    handle {
        root * /srv/tandem-pwa
        header /sw.js Cache-Control "no-cache"
        header /index.html Cache-Control "no-cache"
        try_files {path} /index.html
        file_server
    }
}
```

可选将 `pwa/dist/` 放到 `/srv/tandem-pwa`。独立托管 PWA 时将最后一个 handle 改成 `respond 404`。桌面端配对码中 relay 地址为 `wss://relay.example.com/ws`。

公网只开放 443；8787 只监听 loopback。IP 限流使用 TCP 对端地址，反向代理部署时同一代理下的准入失败共享计数；中转不信任客户端可伪造的 X-Forwarded-For。代理层可按真实来源 IP 补充限流。Caddy 默认没有访问日志；启用时只记录路径，配对码与令牌始终放在 WebSocket 帧内。

协议要求超过 2 MiB 的帧回错误且保持连接，因此应用层接收完整消息后检查大小。部署端应限制连接速率与可用内存；ws 的 maxPayload 硬限制会直接关闭连接，无法满足这一条协议行为。
