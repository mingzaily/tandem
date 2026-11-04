# Tandem Relay

自建中转，计划部署在用户自己的腾讯云服务器上，连接桌面端和手机 PWA。还没有开始。

`packages/` 是从 Cindy 原样复制的代码，不参与构建，也还没有运行过：

| 目录 | 内容 |
|---|---|
| `packages/device-link-relay` | 中转内核：配对、设备签名、媒体中转 |
| `packages/device-link-protocol` | 线协议 |
| `packages/device-link` | 协议客户端和设备签名，内核依赖其中一部分 |

这份代码按 Cindy 的账号体系设计：配对时会核对账号。改造时要去掉账号依赖，并按 Tandem 的数据模型裁剪通道。设计背景见 [`docs/reference/cindy/self-hosted-relay-plan.md`](../docs/reference/cindy/self-hosted-relay-plan.md)。
