# 参考资料

历史资料和参考代码，不构成约束。

## loom 的文档

[`loom/`](loom/) 是更早的深 fork loom 留下的设计和实测记录，保留下来是为了说明当时怎么想的、踩过什么坑。loom 的 Git 历史没有保留。

| 文档 | 内容 |
|---|---|
| [architecture.md](loom/architecture.md) | 三家 CLI 原生会话格式对照、进程模型、单写入者规则 |
| [slimming-plan.md](loom/slimming-plan.md) | 瘦身过程和 B6 启动内存实测 |
| [spike-cindy-native-projection.md](loom/spike-cindy-native-projection.md) | 把原生会话投影到 Cindy 界面的调查 |
| [b7-remote-auth-plan.md](loom/b7-remote-auth-plan.md) | 远程登录方案 |
| [b8-plan.md](loom/b8-plan.md) | B8 批次的调查和范围 |
| [b9-terminal-interop.md](loom/b9-terminal-interop.md) | 和终端交接任务 |
| [measurements/](loom/measurements/) | 各批次的原始实测数据 |

## Cindy 的文档

[`cindy/self-hosted-relay-plan.md`](cindy/self-hosted-relay-plan.md)：Cindy 的自建中转方案。

## 本地参考仓库

`repos/` 已被 Git 忽略，不会上传。新机器上按下面的命令取回：

```bash
cd docs/reference/repos
git clone --filter=blob:none --no-checkout https://github.com/makecindy/cindy.git cindy
git -C cindy switch --detach v0.1.121
git clone --depth 1 https://github.com/zhukunpenglinyutong/desktop-cc-gui.git ccgui
```

| 目录 | 内容 | 许可 |
|---|---|---|
| `repos/cindy` | Cindy `v0.1.121`，界面复刻的基准 | Apache-2.0，名称、Logo、角色形象除外 |
| `repos/ccgui` | desktop-cc-gui，参考原生会话和终端互通的做法 | MIT |
