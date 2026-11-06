# 2026-11-06：标题区与提交动作简化

用户要求将文件变更卡片标题区再缩小，移除“本条消息将加入待发送队列”小字，并通过提交图标表达入队。

## 实现

- 标题区最小 48px，水平 12px、垂直 6px 内距；图标盒 28px，FileDiff 为 16px。标题继续使用 14px/medium，保留累计行数的独立层次，有行数统计时自然增高。这是对 Cindy 原版 64px 标题区的明确适配。
- 编辑区移除入队说明小字和对应的 aria-describedby，清理 useId 与两种语言的旧文案。
- 排队模式使用 15px ListPlus“列表＋”提交图标，悬停提示和可访问名称保持“加入待发送队列”。普通发送使用 ArrowUp，编辑使用“保存修改”，停止使用 Square。
- 图标直接根据既有 queueing 状态选择；排队、编辑、停止和后端生命周期继续沿用现有实现。

代码：[Composer.tsx](../../desktop/src/components/Composer.tsx)、[Composer.test.tsx](../../desktop/src/components/Composer.test.tsx)、[FileChangeSummary.tsx](../../desktop/src/components/FileChangeSummary.tsx)、[i18n.ts](../../desktop/src/lib/i18n.ts)。

本次细节已同步到[待复审材料第 16 节](../reviews/2026-11-05-desktop-ui-details.md#16-最新调整标题密度与入队动作2026-11-06)，先前小字和 64px 标题区的截图作为历史验收保留。

## 审查与验证

- **业务逻辑：** 核对普通发送、运行中入队、暂停队列、编辑保存及队列清空后的动作含义；图标和可访问名称使用同一份 queueing 状态，编辑优先表达保存操作。
- **代码设计：** 复用现有按钮与颜色 token，仅替换状态对应的图标；移除旧提示、关联和状态；标题区继续使用现有字号与自然布局。

两轮审查完成，类型检查通过。前端 18 个测试文件、117 项通过，更新 4 项输入区语义回归检查；Rust 152 项通过。

页面操作通过独立标识调试包的 TANDEM_DRIVE_SCRIPT，CLI 替身经 ZDOTDIR 注入，全部项目、任务、队列与 CLI 数据隔离在临时目录。测试构建临时启用窗口尺寸操作权限，用页面脚本调整到 720×480；release 使用仓库默认配置，保留既有能力清单。

| 页面验证 | 结果 |
|---|---|
| 标题密度 | 无统计时 48px，有累计行数时实测 53px；保留 14px 标题和 12px 行数 |
| 提示与入队 | 空草稿和有草稿均无入队小字；ListPlus、悬停提示与可访问名称正确，点击实际写入暂停队列 |
| 编辑 | 保存继续显示文字；取消后原草稿与 ListPlus 入队动作恢复 |
| 运行状态 | 用一轮 Claude 替身等待任务验证停止与入队共存；停止后队列暂停，删除最后一条后恢复 ArrowUp |
| 720×480 | 文件卡片可完整滚动查看；队列与入队按钮无横向溢出，28×28px 提交入口完整可见 |
| 浅色、深色 | 已检查 4 张目标 Tauri 窗口截图 |
| release | pnpm tauri build --bundles app 通过，约 5.22 MiB；新版本独立启动并显示，既有窗口保留 |

真实模型网络请求与系统输入法未测试。入口脚本约 414.78kB / gzip 125.87kB，沿用已有依赖与进程结构；本轮未复测启动和峰值内存。

测试页面的 localStorage 已逐键恢复并核对，临时任务、队列、替身、调试进程、测试应用和独立 WebKit 数据已清理。四份用户 CLI 配置 SHA-256 与本批开始时一致。保持 main，未提交或推送。

截图：[浅色](assets/composer-actions/light.jpg)、[深色](assets/composer-actions/dark.jpg)、[窄窗口文件卡片](assets/composer-actions/narrow-files-dark.jpg)、[窄窗口入队](assets/composer-actions/narrow-queue-dark.jpg)。
