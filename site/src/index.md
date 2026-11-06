---
layout: home
markdownStyles: false
hero:
  name: Tandem
  text: 三个 Agent，一个桌面。
  tagline: 一个轻量的桌面客户端，连接你自己安装的 Claude Code、Codex 和 Pi。按项目管理任务，看清工作过程，随时回到终端继续。
  actions:
    - theme: brand
      text: 认识 Tandem
      link: /guide/
    - theme: alt
      text: 桌面端使用指南
      link: /guide/desktop
---

<div class="product-home">
  <section class="product-section" aria-labelledby="workspace-title">
    <p class="product-eyebrow">熟悉的工具，连贯的工作</p>
    <h2 id="workspace-title">从项目出发，接着你的任务。</h2>
    <p class="product-lead">把分散在终端里的任务放回项目中。选择合适的 Agent，打开已有任务，或从一个新问题开始。</p>
    <div class="product-features">
      <article>
        <h3>项目和任务，一眼找到</h3>
        <p>Claude Code、Codex 和 Pi 的任务按项目归在同一侧栏。搜索、置顶、归档和重命名，让正在做的事各有位置。</p>
      </article>
      <article>
        <h3>工作过程，展开就能看</h3>
        <p>阅读 Markdown 和代码，查看工具调用与思考过程。已完成的工作收起，当前进展、用时和输出 token 保持可见。</p>
      </article>
      <article>
        <h3>下一条消息，提前准备</h3>
        <p>Agent 工作时继续准备消息，放进待发送队列。随时编辑、排序或删除，正常结束后依次发送。</p>
      </article>
    </div>
  </section>

  <section class="product-section product-workflow" aria-labelledby="workflow-title">
    <div>
      <p class="product-eyebrow">在桌面上推进工作</p>
      <h2 id="workflow-title">工具你来选，<br>节奏你来定。</h2>
      <p class="product-lead">沿用各 CLI 的模型、配置和登录状态，在一个窗口里完成日常操作。</p>
      <a class="product-link" href="./guide/desktop">查看桌面端使用指南 <span aria-hidden="true">→</span></a>
    </div>
    <ol class="product-steps" role="list">
      <li><span class="product-step-number" aria-hidden="true">01</span><div><h3>选择项目与 Agent</h3><p>添加自己的项目目录，选择 Claude Code、Codex 或 Pi，再设置模型和推理强度。</p></div></li>
      <li><span class="product-step-number" aria-hidden="true">02</span><div><h3>发送消息，查看进展</h3><p>输入需求，粘贴图片或附上文件。按 Agent 提供的能力确认工具操作、回答提问。</p></div></li>
      <li><span class="product-step-number" aria-hidden="true">03</span><div><h3>继续已有任务</h3><p>任务记录由各 CLI 保存。下次从 Tandem 打开，或复制续接命令回到终端。</p></div></li>
    </ol>
  </section>

  <section class="product-section product-remote" aria-labelledby="remote-title">
    <div>
      <p class="product-eyebrow">需要时，把手机也接进来</p>
      <h2 id="remote-title">离开桌前，接着做。</h2>
      <p class="product-lead">在手机上查看任务、发送消息、确认操作和回答提问。电脑保持运行与联网，Agent 继续在电脑上工作。</p>
      <p>手机访问按需开启，通过你自己部署的中转连接。任务内容在手机与电脑之间端到端加密；设备丢失时，在电脑上撤销访问。</p>
      <a class="product-link" href="./app/" target="_self">打开手机端 <span aria-hidden="true">→</span></a>
      <p>首次使用，先按<a href="./guide/quick-start">部署指南</a>准备自己的中转。</p>
    </div>
    <figure class="product-connection">
      <div class="product-route"><div><span>你的电脑</span><strong>Tandem + CLI</strong></div><span class="product-route-arrow" aria-hidden="true">↔</span><div><span>你部署的服务</span><strong>中转</strong></div><span class="product-route-arrow" aria-hidden="true">↔</span><div><span>你的手机</span><strong>Tandem PWA</strong></div></div>
      <figcaption>电脑与手机主动连接中转，电脑无需开放入站端口。</figcaption>
    </figure>
  </section>

  <section class="product-section product-ownership" aria-labelledby="ownership-title">
    <p class="product-eyebrow">自己的工具，自己的记录</p>
    <h2 id="ownership-title">任务留在熟悉的地方。</h2>
    <p class="product-lead">Tandem 使用你安装的 CLI，已发送任务保留在它们的原生记录中。模型请求由 CLI 发出，账号和服务也沿用你的选择。</p>
    <p>Tandem 基于 Tauri 与 Rust 构建。桌面端的日常工作在本机完成，无需 Tandem 账号；应用没有遥测、崩溃上报或自动更新。</p>
    <a class="product-link" href="./guide/">进一步了解 Tandem <span aria-hidden="true">→</span></a>
  </section>
</div>
