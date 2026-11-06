# HTTPS 与反向代理

容器监听明文 HTTP 和 WS。网关对外提供 HTTPS 与 WSS，桌面端填写 `wss://relay.example.com/ws`。手机可<a href="../app/" target="_self">打开官网手机端</a>，中转地址由配对码提供；自托管手机页面位于 `https://relay.example.com`。

## nginx

证书路径替换为自己的证书。在 `http` 块中添加 `map`，再添加站点配置：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name relay.example.com;
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
}
```

`Upgrade` 和 `Connection` 负责 WebSocket 升级。读超时为 120 秒，大于中转的 90 秒无响应窗口。设置 `TANDEM_RELAY_TRUST_PROXY=1`，中转按 `X-Forwarded-For` 最后一段限制准入失败次数。

这里用 `$remote_addr` 覆盖客户端提供的头，适用于 nginx 直接面对手机和电脑的部署。前面还有 CDN 时，应先用 nginx 的可信来源地址配置解析 CDN 地址，确保 `$remote_addr` 是已验证的客户端地址。

## Caddy

域名 DNS 指向服务器后，Caddy 在网关申请并终止 TLS：

```text
relay.example.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Forwarded-For {remote_host}
        transport http {
            read_timeout 120s
            write_timeout 120s
        }
    }
}
```

Caddy 自动处理 WebSocket 的 `Upgrade` 与 `Connection` 头。上例覆盖 `X-Forwarded-For`，与 `TANDEM_RELAY_TRUST_PROXY=1` 配合使用。读超时大于 90 秒。

两种部署都只向公网开放网关端口。上面的 loopback 地址适用于网关运行在宿主机；网关也在容器中时，使用同一私有 Docker 网络和 `relay:8787`，移除 relay 的公网端口映射。
