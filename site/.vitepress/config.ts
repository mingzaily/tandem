import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  title: "Tandem",
  description:
    "Tandem 是一个轻量的桌面客户端，在同一个窗口中使用你自己安装的 Claude Code、Codex 和 Pi，按项目管理任务，并可从手机继续工作。",
  base: "/tandem/",
  srcDir: "src",
  cleanUrls: true,
  head: [["link", { rel: "icon", href: "/tandem/icon.svg" }]],
  themeConfig: {
    logo: "/icon.svg",
    nav: [
      { text: "首页", link: "/" },
      { text: "使用文档", link: "/guide/" },
      { text: "手机访问", link: "/guide/quick-start" },
      // Load the separate application with a full navigation outside the documentation router.
      { text: "打开手机端", link: "/app/", target: "_self" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始使用",
          items: [
            { text: "认识 Tandem", link: "/guide/" },
            { text: "桌面端使用", link: "/guide/desktop" },
          ],
        },
        {
          text: "手机访问",
          items: [
            { text: "部署手机远程访问", link: "/guide/quick-start" },
            { text: "桌面端与手机配对", link: "/guide/pairing" },
            { text: "安全模型", link: "/guide/security" },
          ],
        },
        {
          text: "中转配置与维护",
          items: [
            { text: "环境变量", link: "/guide/configuration" },
            { text: "HTTPS 与反向代理", link: "/guide/proxy" },
            { text: "升级与排错", link: "/guide/maintenance" },
          ],
        },
      ],
    },
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                noResultsText: "没有找到相关内容",
                resetButtonTitle: "清空",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                  closeText: "关闭",
                },
              },
            },
          },
        },
      },
    },
    outline: { label: "本页内容", level: [2, 3] },
    docFooter: { prev: "上一篇", next: "下一篇" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "文档目录",
    darkModeSwitchLabel: "外观",
    footer: { message: "你的 CLI，你的项目，你的任务。", copyright: "Tandem" },
  },
});
