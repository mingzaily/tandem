# 原生会话

> **状态**：权威
> **读取时机**：读写任务数据、接入新 CLI 之前

各 CLI 的文件格式对照和早期设计见 [`reference/loom/architecture.md`](../reference/loom/architecture.md)，当时踩过的坑见同目录的其他文档。

## Claude Code

**位置**：`$CLAUDE_CONFIG_DIR/projects/<编码后的目录>/<uuid>.jsonl`，默认是 `~/.claude`。不要用工作目录去计算编码后的目录名，超长路径会对不上，要扫描目录。工作目录从文件内容的 `cwd` 字段读取。

**任务列表**：只读文件开头（`cwd`、首条提示词）和结尾 256 KB（标题）。标题优先级：`custom-title`、`ai-title`、首条提示词。

**消息内容**：

- 只取 `user` 和 `assistant` 行，跳过 `isSidechain`（子 Agent）和 `isMeta`。
- 回退（rewind）会在文件里留下废弃分支。要从最新一行沿 `parentUuid` 回溯，压缩后沿 `logicalParentUuid` 继续。
- 并行工具调用不全在这条链上：同一 `message.id` 的其他内容块和对应的 `tool_result` 要补回来。
- CLI 把部分内部信息写成用户文本，比如 `<local-command-*>`、`<command-name>` 和 `[Request interrupted by user…]`，显示前要转换。
- 解析失败的行要跳过，文件结尾可能有半行。

**体积控制**：工具输出每条截断到 20 KB，工具输入的每个字符串截断到 4 KB，并保持 JSON 有效。

**驱动**：

```bash
claude -p --input-format stream-json --output-format stream-json \
  --verbose --include-partial-messages \
  --session-id <新 uuid>   # 新任务
  --resume <uuid>          # 续接
```

`parent_tool_use_id` 不为空的输出属于子 Agent，主对话不显示。权限被拒绝的工具在 `result.permission_denials` 里。

## 已知限制

见 [路线图](../roadmap.md)。主要是：还没有审批，Codex 和 Pi 还没接入，还没有防止和终端同时写一个任务。

## 接入新 CLI 时

先确认它的官方接口和实际文件格式，写进本文件，再实现。读取和驱动都要有基于构造数据的测试。
