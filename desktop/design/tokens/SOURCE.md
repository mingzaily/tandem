# Token 来源

这些文件取自 Cindy `v0.1.121` 的生成结果，之后由本仓库维护，不再同步。

| 文件 | 来源 |
|---|---|
| `tokens.css` | `apps/desktop/src/renderer/styles/generated/tokens.css` |
| `colors.css` | `apps/desktop/src/renderer/themes/colors.ts` 的 `GENERATED_DEFAULTS`，只保留默认浅色和深色 |
| `theme.css` | `apps/desktop/src/renderer/themes/builtin/cindy-light.ts`、`cindy-dark.ts` 的覆盖值。浅色的选中行按用户提供的运行截图改成白底深字，并增加 `--brand-mark-accent` |
| `themes.css` | 同目录 `themes/builtin/` 下其他内置主题的覆盖值 |
| `tailwind.generated.ts` | `apps/desktop/tailwind.config.ts` 的生成区 |
| `code-dark.css` | `apps/desktop/src/renderer/styles/globals.css` 的深色代码配色 |

路径相对于 `docs/reference/repos/cindy`。
