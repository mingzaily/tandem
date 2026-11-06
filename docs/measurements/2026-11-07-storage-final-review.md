# 存储最终复审验收（2026-11-07）

起点为干净的 `main`，提交 `bb622f8`。本批按最终清单修改桌面端、relay 启动错误、site 排错文档和 CI；没有提交、推送或切换分支。

## 实现与边界

| 清单 | 当前实现 |
|---|---|
| 1. 删除旧数据导入 | 删除复制、旧页面解析、预览与重试命令、等待状态、旧来源环境变量和对应测试；队列只读取图片文件引用。保留 `.gitignore` 生成和进程级 `.storage.lock` |
| 2. 一次性清理 | 先完整列出旧目录，核对已完成标记、TOML 和两边待发条目。删除旧空队列目录和 WebKit 的旧页面存储，详情见下表 |
| 3. 状态损坏 | 读取或解析失败时，将原路径改名为 `state.json.<UUID>.corrupt`；内存采用默认状态，通过 errors 显示路径。状态缺失同样直接使用默认值，队列与发送保持独立 |
| 4. 桌面 CI | `desktop/**` 纳入路径，新增 `macos-15` job，执行 typecheck、前端测试、Rust 测试和全目标 clippy。沿用固定 commit SHA 的 Actions 和 `contents: read` |
| 5. 未知字段 | 状态与任务元数据忽略未知字段；TOML 忽略未知字段的值、提示完整名称，保留字段和注释。语法、类型和已知值的错误仍拒绝覆盖文件 |
| 6. relay | 文件损坏的提示原已包含路径与恢复办法，保持原行为；补齐读取失败的路径、原因和改名重启指引。真实 WebSocket 测试确认重启后重新登记原令牌可恢复准入 |
| 7. clippy | 发送参数归入请求结构，删除转发包装函数；控制请求较大变体使用 Box；其余采用字符数组、`is_none_or` 和 `slice::from_ref`。没有新增 allow |
| 8. 文档 | 更新存储、桌面驱动、架构、CI、仓库地图、AGENTS、待复审记录及 site 排错页 |

写锁现在只表达本进程是否持有数据目录的写入权。第二个实例读取配置与界面状态，提示先退出占用者再重新打开，拒绝设置、队列、配对和发送等写操作；它也不会隔离状态文件。

自审补了一条实际文件权限失败路径：状态文件改名失败时，后续原子保存会恢复目录权限，原实现可能因此覆盖未隔离的坏文件。现在只拒绝这次界面状态保存，保留原文件，队列和发送仍可使用。

## 先失败、后修复

| 回归测试 | 修改前 | 修改后 |
|---|---|---|
| 坏状态保留且发送可用 | 发送权限检查失败 | 坏文件隔离，采用默认值 |
| 缺失状态和空目录可立即使用 | 发送权限检查失败 | 生成 TOML / 忽略规则，立即可写 |
| 未知状态字段保留已知值 | 反序列化失败 | 已知置顶、宽度正常，废弃字段不再输出 |
| 未知 TOML 字段保持有效配置 | 深色被替换为默认配置 | 深色与模型生效，完整字段名进入 errors |
| relay 文件读取失败的指引 | 只有系统 IO 错误 | 包含路径、改名重启与重新登记说明 |
| 状态隔离失败保护原文件 | 原子保存覆盖坏文件 | 拒绝状态保存，坏文件保留，发送权限仍有效 |

失败日志见 [failure-tests.txt](assets/storage-final-review/failure-tests.txt)。状态读取还覆盖目录占用路径、运行中写坏状态、第二实例保持原文件，以及 TOML 手改、错误恢复、注释保留、别名删除和系统语言内存状态。

## 实际删除的旧数据

旧目录 `~/Library/Application Support/com.mingzaily.tandem/` 的完整清单只有：

```text
queues/
└── 20f65960-8a33-43d2-9e91-4e0b48f06951.json  (117 B，entries 为空，无 inFlight)
```

核对时，`~/.tandem/state.json` 的已完成值为 1，`config.toml` 存在，新队列没有条目或内联图片；旧队列也没有待发条目。检查和清理时均没有 Tandem 进程。

| 路径 | 实际操作 |
|---|---|
| 旧 Application Support 的 `queues/` | 已删除，包含上面唯一的空队列文件 |
| 旧 Application Support 的 `remote.json` | 原本不存在 |
| `~/Library/WebKit/com.mingzaily.tandem/LocalStorage/` | 清单指定的路径，原本不存在。WebKit 实际存放在下一行的位置 |
| `~/Library/WebKit/com.mingzaily.tandem/WebsiteData/Default/<来源>/<来源>/LocalStorage/localstorage.sqlite3`（含 `-shm`、`-wal`） | 复审时发现仍保存 14 个 `tandem.*` 旧键。确认生产代码无浏览器持久化调用、Tandem 空闲并退出、文件无占用后删除，空目录保留 |
| 旧 Application Support 目录本身及其他 WebKit 内容 | 保留 |
| `~/.tandem` 和三 CLI 目录 | 清理操作保持原样；替身验证全部使用独立目录 |

原始清单见 [preflight.json](assets/storage-final-review/preflight.json)，第一轮删除记录见 [deleted.json](assets/storage-final-review/deleted.json)；其中的 `already absent` 只针对清单路径，实际旧键由复审删除。

## 原生替身验收

使用独立 `Tandem Final Audit` / `com.mingzaily.tandem.final-audit` 调试包和 `TANDEM_DRIVE_DATA_DIR`。`ZDOTDIR` 提供三 CLI 替身；原生会话与各 CLI 根目录均在临时目录。发送替身先断言工作目录，再记录回执；没有真实模型请求。

- **坏状态启动：** 原内容保留为 corrupt 文件；原队列恢复并实际发送，另发的新消息收到成功回执，页面显示保留路径。
- **缺失状态启动：** 原队列照常恢复、发送，新消息也成功。
- **未知 TOML 字段：** 主字段与嵌套字段完整提示，深色继续生效；保存为浅色后，未知字段及其注释继续保留。还通过真实输入框的原生 setter 和页面 Enter 事件发送，输入清空、历史结果可见。
- **旧状态字段：** 输入中带旧完成字段及额外状态、任务元数据字段，已知置顶保持，队列恢复与发送成功；后端快照仅输出当前字段。
- **两个实例：** 两进程同时存活时，第二个拒绝设置、状态、队列加载和发送，目录全部文件哈希保持一致。随后关闭测试主实例，检查被阻止窗口仍明确提示重开，保持只读。
- **全新空目录：** 自动生成 `config.toml` 和 `.gitignore`，首屏注入配置与 DOM 主题一致，输入可用，替身发送成功，未创建 cache。

页面原始断言见 [page-assertions.json](assets/storage-final-review/page-assertions.json)，双实例文件核对见 [single-writer.json](assets/storage-final-review/single-writer.json)。所有交互均为页面脚本，没有系统鼠标或键盘模拟。空目录的最终截图通过 `open -n` 一次传入完整隔离环境前台启动，避免后台 WebView 的合成未更新影响截图。

## 实际查看的截图

最终留存六张目标窗口截图，均逐张查看。提示文字完整换行，输入区与主界面保持可用，1200×800 页面断言没有横向滚动。

- 状态损坏：[浅色](assets/storage-final-review/state-corrupt-light.png)、[深色](assets/storage-final-review/state-corrupt-dark.png)。
- 未知配置：[浅色](assets/storage-final-review/config-unknown-light.png)、[深色](assets/storage-final-review/config-unknown-dark.png)。
- [第二实例只读提示](assets/storage-final-review/second-instance.png)。
- [空目录首次启动](assets/storage-final-review/fresh-start.png)。

## 检查结果

| 范围 | 命令 | 结果 |
|---|---|---|
| desktop | `pnpm typecheck` | 通过 |
| desktop | `pnpm test` | 167 项，30 个文件通过 |
| desktop/src-tauri | `cargo test` | 193 项通过；1 项原有大图性能专项默认忽略 |
| desktop/src-tauri | `cargo clippy --all-targets -- -D warnings` | 通过 |
| relay | `cargo test` / clippy | 11 项通过，clippy 通过 |
| relay | `pnpm test` | 20 项真实 WebSocket 集成测试通过 |
| site | `pnpm build:pages` / `pnpm test` | 组合官网与 PWA 构建通过，2 项测试通过 |
| CI | actionlint 1.7.12 检查 `ci.yml` | 通过 |

全仓库搜索已执行：运行代码中没有旧导入功能引用；旧字段名称仅留在未知字段回归输入中。锁文件的 `character-entities-legacy` 是现有第三方包名，Cindy 原版规范、参考仓库和历史验收保持原样。浏览器持久化只保留一处测试替身，用于在误读时立即失败；生产代码没有读写调用。

## 两轮自审与限制

- **业务逻辑：** 核对单实例所有权、缺失和损坏状态、原文件保留、未知字段、队列独立性及三 CLI 接收边界；补测并修复状态隔离失败后的覆盖路径。原有三个 CLI 的 17 个独立子进程回执场景继续通过。
- **代码设计：** 删除旧状态机、读写门禁和转发包装；所有权与配置、状态解析分开，设置页保持增量写入与注释保留；发送参数使用已有请求结构，控制请求只对大字段引入 Box。

GitHub 托管 runner 的实际执行、真实 CLI 模型网络、公网 WSS 和手机真机重连不属于本轮本机验收；relay 恢复路径已由本机真实 WebSocket 覆盖。本轮没有重测整机启动耗时和内存，也没有逐帧录制主题绘制过程。

`pnpm tauri build --bundles app` 构建通过，Tandem.app 约 5.57 MiB。打开前没有旧 Tandem 进程；已打开正常 release 并确认进程启动。正式配置、状态、配对文件与忽略规则的哈希在打开前后保持一致，四份 CLI 配置哈希与本批开始时一致。

测试进程、临时原生会话、项目、CLI 目录、数据目录、调试包与独立 WebKit 配置已清理。没有操作测试页面的浏览器持久化数据，也没有关闭用户旧窗口；只保留用户要求打开的正常 release。最终核对见 [checks.json](assets/storage-final-review/checks.json)，测试清理见 [cleanup.json](assets/storage-final-review/cleanup.json)，命令记录见 [validation.txt](assets/storage-final-review/validation.txt)。
