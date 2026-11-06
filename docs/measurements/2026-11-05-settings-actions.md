# 设置页操作布局验收

日期：2026-11-05。范围：项目、对话工作区、远程设置，以及 Agent 页共用的操作按钮。

## 设计结果

按用户确认的“就近操作”方案实现：添加项目与配对新设备放在分组标题右侧，更改目录、加入、移除与撤销放在对应行右侧。根据用户反馈，将“保存更改”固定放到“中转服务”标题右侧，未修改时禁用；有编辑内容时在旁边显示“还原更改”。中转卡片只保留地址、令牌和操作错误，移除底部整行状态。

`SettingsButton.tsx` 对照 Cindy 的 `components/ui/button.tsx`：32px 高、13px/500 字号、胶囊圆角，统一描边、灰底、辅助和危险色操作。悬停与按下颜色由基础表面色递进，加载保留按钮宽度和可访问名称。目录行参考 `DialogueDirectorySection.tsx`。

手机访问开关使用已保存的中转配置。表单保存失败保留地址与令牌；连接状态刷新保留草稿，包括主动清空的地址。生成、取消配对与撤销设备显示请求状态；配对条件未满足时说明原因。连接状态放在“允许手机访问”的说明中，标题按钮通过原生 `form` 属性关联表单，点击和回车共用提交及校验流程。

后端保存配置与撤销设备均在持久化成功后更新内存。写盘失败时，已生效配置和已配对设备保留，用户可以重试。配对指南同步为“保存中转配置 → 开启访问 → 配对新设备”。

## 审查结果

- 业务逻辑：核对草稿、已保存配置、访问开关、连接状态、配对与撤销的生命周期，以及失败后的重试语义；修复了写盘失败提前改变内存状态的问题。
- 代码设计：按钮统一组件，草稿转换集中在纯 reducer；请求状态按表单与设备操作呈现，异步读取按请求顺序更新。复用现有 Tauri 命令、目录选择器和配对流程。
- 本次变更范围内无已知阻塞问题。

## 验证结果

| 验证 | 结果 |
|---|---|
| 桌面前端类型检查、生产构建、单元测试 | 通过，81 项；新增 4 项草稿状态回归测试 |
| 桌面 Rust 测试 | 通过，152 项 |
| 独立标识的 Tauri 调试构建 | 通过，`com.mingzaily.tandem.settings-audit` |
| 常规 Tauri 调试构建 | 通过，仓库默认标识与常规前端产物，输出 `Tandem.app` |
| 原生应用与本地 Rust 中转 | 15 项断言通过，覆盖真实保存失败、成功保存、访问开关、配对码生成与取消、深色主题 |
| 原生写盘失败与重试 | 6 项界面/内存断言、4 项文件断言通过；用测试应用的 `remote.tmp` 同名目录触发真实写盘失败 |
| 浏览器界面交互 | 27 项断言通过；覆盖目录选择、加入与移除、目录恢复、表单提交、重复提交、加载保宽、读取失败与重试 |
| 标题保存操作复验 | 14 项断言通过，覆盖按钮位置、表单关联、校验、回车提交、重复提交、加载保宽、失败重试及状态位置；重新运行前端 81 项测试和常规调试构建均通过 |
| 最小窗口 | 720×800，无横向溢出；悬停反馈与键盘焦点通过；标题保存调整后重新检查浅色与深色 |
| 站点构建与链接测试 | 通过 |
| `git diff --check` | 通过 |

原生测试使用独立应用标识、替身 CLI 与临时配置目录。测试结束后恢复该应用的 localStorage，删除测试应用的远程配置，停止本轮启动的应用、中转和浏览器进程。浏览器使用同一份前端构建与测试 IPC 数据，目录选择、请求延迟和读取失败通过替身验证。

本轮 macOS 目标窗口截图返回 `could not create image from window`。下面的截图来自实际前端构建在 Chromium 中的运行结果，均已目视检查；原生应用的流程与尺寸通过页面脚本验证。

## 截图

| 页面 | 截图 |
|---|---|
| 项目，浅色与深色 | [浅色](assets/settings-actions/projects-light.png)、[深色](assets/settings-actions/projects-dark.png) |
| 远程，首次配置、已连接、草稿 | [首次配置](assets/settings-actions/remote-initial-light.png)、[已连接](assets/settings-actions/remote-light.png)、[草稿](assets/settings-actions/remote-dirty-light.png)、[连接中的草稿](assets/settings-actions/remote-connected-draft-light.png) |
| 配对，浅色与深色 | [浅色](assets/settings-actions/remote-pair-light.png)、[深色](assets/settings-actions/remote-pair-dark.png) |
| Agent 共用按钮 | [浅色](assets/settings-actions/agents-light.png) |
| 最小窗口 | [项目](assets/settings-actions/projects-720-light.png)、[远程浅色](assets/settings-actions/remote-720-light.png)、[远程深色](assets/settings-actions/remote-720-dark.png) |
