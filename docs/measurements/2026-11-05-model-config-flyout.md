# 2026-11-05：模型列表与独立配置浮层

参考本地 Cindy 的 `ModelSelector.tsx`、`UnifiedModelPanel.tsx`、`UnifiedModelRow.tsx`、`UnifiedFlyoutHost.tsx`、`ModelConfigFlyout.tsx` 与 `unifiedModelSelection.ts`。

## 展示与交互

- 主列表区域采用 428px，普通任务中的面板实测高 471px；向上空间不足时列表收缩并内部滚动。外层上限为 560px 和视口高度减 120px。主列表底部的常驻强度滑杆已移到行旁配置。
- 独立配置宽 264px、与主面板间隔 4px，内距采用 14px、底部 12px。优先放在主面板左边，另一侧空间更合适时换边；窄窗口采用视口约束，允许覆盖主面板边缘。
- 支持至少两个强度档位的模型提供配置按钮、右键和左方向键入口。配置按钮在悬停、键盘聚焦或配置展开时显示。单档和无思考能力的模型保持直接选择。
- Tandem 按 CLI 保存当前发送偏好。配置浮层内的调整作为预览，点“使用此模型”后将模型和强度一起应用，保留权限。关闭或切换配置会结束当前预览；“恢复默认”恢复 CLI 默认强度。主列表中直接点击模型仍可选择。
- 配置浮层与主菜单共享关闭边界，点击滑杆和按钮保持主菜单展开。Esc 先关闭配置并把焦点放回模型行，再次 Esc 关闭主菜单并返回入口。键盘打开时，在浮层定位显示后聚焦滑杆。
- CLI 默认模型继续使用“默认”文字标记；选择默认项保存跟随配置的引用。未增加收藏、模型配置文件写入或手机协议。

## 验证

页面操作全部通过调试版 `TANDEM_DRIVE_SCRIPT`；原生窗口工具仅用于读取目标窗口和截图。替身 CLI 通过 `ZDOTDIR` 注入，Claude、Codex、Pi、队列与项目均使用临时目录，调试包使用独立名称和应用标识。测试前记录页面 localStorage，完成后逐键恢复并核对。

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 17 个文件，107 项通过；新增定位边界与模型/强度组合测试 |
| `cargo test` | 152 项通过 |
| 三种 CLI | 默认标记、浏览与选择分离、模型与强度确认应用通过；Codex 六档和 Pi“关闭思考”通过 |
| 配置交互 | 点击切换、右键、左方向键、两层 Esc、焦点返回、预览、恢复默认、指针取消与点击外部通过 |
| 列表与刷新 | 长列表末行完整可读；配置保持随滚动定位；刷新失败显示原因并保留缓存与默认标记，恢复后清除错误 |
| 720×480 | 任务页列表高 282px，新建页列表约 239px；主菜单仍向上，配置与确认按钮均在视口内，浅深色已检查 |
| 截图 | Claude、Codex、Pi 各自浅色和深色，以及两张窄窗口截图均已检查 |
| release | `pnpm tauri build --bundles app` 通过，5.22 MiB；新版本已打开，显示进行中任务的旧窗口保持打开 |

业务逻辑审查检查模型与强度的组合、默认引用、权限保留、预览取消、刷新与能力变化，以及既有任务和新建任务的 CLI 边界。代码设计审查检查组件职责、Portal 归属、监听清理、键盘焦点、列表收缩和按需加载。两轮审查完成。

模型面板与强度控件改为首次打开时加载，独立脚本约 15.78 kB / gzip 5.22 kB。入口约 414.25 kB / gzip 125.83 kB，较上一批减少约 9.07 kB / gzip 2.22 kB；沿用现有依赖与进程结构。本批未重新测量启动耗时和内存峰值。

替身记录中模型提示词和线程启动均为 0；真实模型网络请求未验证。两份调试页面存储已恢复，临时任务、替身目录、调试进程和独立 WebKit 数据已清理；四份用户 CLI 配置 SHA-256 保持一致。保持 `main`，未提交或推送。

截图：[Claude 浅色](assets/model-config-flyout/claude-light.png)、[Claude 深色](assets/model-config-flyout/claude-dark.png)、[Codex 浅色](assets/model-config-flyout/codex-light.png)、[Codex 深色](assets/model-config-flyout/codex-dark.png)、[Pi 浅色](assets/model-config-flyout/pi-light.png)、[Pi 深色](assets/model-config-flyout/pi-dark.png)、[窄窗口浅色](assets/model-config-flyout/narrow-light.png)、[窄窗口深色](assets/model-config-flyout/narrow-dark.png)。
