# 部署手机远程访问

手机远程访问需要一台持续运行 Tandem 的电脑，以及你自己部署的中转服务。公共手机端从官网打开，加密消息通过你自己的中转传递，Agent 在电脑上执行任务。Tandem 提供客户端页面，中转由使用者部署。

准备 Docker Compose、自己的域名和能够终止 TLS 的网关。桌面端和手机都需要能访问这个域名。桌面端的日常操作见[桌面端使用](./desktop.md)。

## 1. 设置部署令牌

在部署目录创建 `.env`，将下面命令生成的随机值作为令牌保存，并限制文件权限：

```sh
umask 077
printf 'TANDEM_RELAY_HOST_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
```

桌面端使用相同的部署令牌。令牌只放在部署环境和桌面端设置中。

## 2. 启动容器

保存为 `compose.yaml`：

```yaml
services:
  relay:
    image: ghcr.io/mingzaily/tandem-relay:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8787:8787"
    environment:
      TANDEM_RELAY_HOST_TOKEN: ${TANDEM_RELAY_HOST_TOKEN:?请先设置部署令牌}
      TANDEM_RELAY_TRUST_PROXY: "1"
    volumes:
      - relay-data:/data
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    stop_grace_period: 15s
volumes:
  relay-data:
```

```sh
docker compose up -d
docker compose exec relay /tandem-relay healthcheck
curl http://127.0.0.1:8787/healthz
```

健康接口返回 `{"ok":true,"v":1}`，WebSocket 路径为 `/ws`。用浏览器打开中转域名时，页面只显示部署状态。手机端从官网打开。compose 不需要设置 `user`。数据目录不可写时，中转会在启动时退出。

## 3. 配置 HTTPS 网关

按[反向代理示例](./proxy.md)将 `https://relay.example.com` 转到本机 8787。WebSocket 对外地址为 `wss://relay.example.com/ws`。

**对外必须使用 HTTPS 和 WSS。** WebCrypto 要求 HTTPS 安全上下文，桌面端也只允许本机地址使用 `ws://`。容器保持 HTTP/WS，证书由网关管理。

## 4. 配对

在电脑设置里填写中转域名与部署令牌。域名会自动补成 `wss://域名/ws`，完整地址也可以粘贴。手机<a href="../app/" target="_self">打开官网手机端</a>，先安装到主屏幕，再从主屏幕打开并配对，详见[配对步骤](./pairing.md)。中转地址随配对码传给手机。
