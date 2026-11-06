# Tandem 官网

独立 VitePress 项目，默认中文。`src/index.md` 为产品首页，`src/guide/` 为用户文档；仓库 `docs/` 只供开发使用，构建不读取它。

首页介绍桌面客户端的用途、三个 Agent、任务工作流及可选手机访问。文档按“开始使用”“手机访问”“中转配置与维护”组织；`src/guide/desktop.md` 为桌面端指南，`src/guide/quick-start.md` 保留原路径，内容为手机远程访问的部署步骤。站点正文面向使用者，仓库发布与站点维护说明放在本 README 及 `relay/README.md`。

官网的“打开手机端”入口指向 `/tandem/app/`。`pwa/`、`site/`、`relay/` 继续位于仓库顶层，各自构建；发布脚本组合官网与 PWA 的产物。公共页面连接使用者自己部署的 WSS 中转。

中转镜像由 `relay-v*` tag 发布，同名镜像标签可用于固定版本，`latest` 由更高的正式 `relay-vX.Y.Z` 版本晋升。桌面端保留 `v*` tag，发布流程相互独立。

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

组合 Pages 产物和检查链接：

```sh
pnpm --dir ../pwa install --frozen-lockfile
pnpm build:pages
pnpm test
pnpm preview
```

`.github/scripts/build-pages.mjs` 分别运行两个项目的构建，将带 `/tandem/app/` base 的 PWA 产物复制到 `site/.vitepress/dist/app/`。`pnpm build` 仍单独构建官网；组合预览和发布使用 `build:pages`，链接检查针对组合产物。

`.github/workflows/site-pages.yml` 在官网、PWA、中转、共用设计 token、协议或自动化文件变更进入 main 后，先执行共享检查，浏览器验收通过后再上传组合产物并发布 GitHub Pages，也可手动触发。本地在仓库根目录运行 `node .github/scripts/verify.mjs` 复现同一套项目检查，详见 [CI 与本地验证](../docs/dev-rules/ci-validation.md)。

仓库 Settings → Pages 的 Source 选择 GitHub Actions。目标地址为 `https://mingzaily.github.io/tandem/`，文档入口为 `/tandem/guide/`，手机端为 `/tandem/app/`。本地组合预览带相同路径前缀。
