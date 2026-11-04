# 文档索引

所有规范和工程管理文档都放在这里。结构和写法仿照 Cindy，内容按 Tandem 的实际情况重写。

**状态含义**：`权威` = 对相关改动有约束力；`参考` = 背景资料，不构成约束。

| 文档 | 状态 | 什么时候读 |
|---|---|---|
| [product-rules/core-product-principles.md](product-rules/core-product-principles.md) | 权威 | 新增或调整任何功能 |
| [product-rules/task-and-conversation-naming.md](product-rules/task-and-conversation-naming.md) | 权威 | 写涉及任务、对话、消息的文案 |
| [design-rules/README.md](design-rules/README.md) | 权威 | 改界面、样式、动效、文案 |
| [dev-rules/repo-map.md](dev-rules/repo-map.md) | 权威 | 找代码入口 |
| [dev-rules/environment-setup.md](dev-rules/environment-setup.md) | 权威 | 首次搭环境 |
| [dev-rules/desktop-development.md](dev-rules/desktop-development.md) | 权威 | 启动、验证、驱动桌面端 |
| [dev-rules/engineering-conventions.md](dev-rules/engineering-conventions.md) | 权威 | 写前端或 Rust 代码和测试 |
| [dev-rules/architecture-invariants.md](dev-rules/architecture-invariants.md) | 权威 | 改模块依赖或数据流 |
| [dev-rules/security-and-process-boundaries.md](dev-rules/security-and-process-boundaries.md) | 权威 | 新增 Tauri 命令、权限、外部进程 |
| [dev-rules/credentials-and-local-storage.md](dev-rules/credentials-and-local-storage.md) | 权威 | 处理凭证或写文件 |
| [dev-rules/native-sessions.md](dev-rules/native-sessions.md) | 权威 | 读写任务数据、接入新 CLI |
| [dev-rules/development-workflow.md](dev-rules/development-workflow.md) | 权威 | 分批、提交、Review、汇报 |
| [roadmap.md](roadmap.md) | 权威 | 决定下一步做什么 |
| [decisions.md](decisions.md) | 权威 | 了解已定和待定的决策 |
| [measurements/](measurements/2026-11-04-startup-and-memory.md) | 参考 | 比较启动和内存 |
| [reference/](reference/README.md) | 参考 | 查 loom 的历史文档，以及本地的 Cindy、ccgui 代码 |

## 收录规则

- 产品规则写用户应该得到什么结果；开发规则写代码怎样实现和验证；设计规则写界面长什么样。不要混写。
- 每条规则写清触发条件、要做什么、不能做什么、怎么验证。
- 能用测试或类型检查保证的规则，同时落实到自动检查。
- 还没实现的内容写进路线图，不写成现状。
