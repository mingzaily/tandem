// Run the existing debug app against fixture CLIs without touching the user's CLI files.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  chmod,
  access,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { startRelay } from "./rust-relay.ts";
import { grantProxy } from "./grant-proxy.ts";
import { desktopInterop } from "./desktop-interop.mts";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binary =
  process.env.TANDEM_DESKTOP_TEST_BINARY ??
  join(
    root,
    "desktop/src-tauri/target/debug/bundle/macos/Tandem.app/Contents/MacOS/tandem",
  );
const remote = join(
  homedir(),
  "Library/Application Support",
  process.env.TANDEM_DESKTOP_TEST_IDENTIFIER ?? "com.mingzaily.tandem",
  "remote.json",
);
try {
  await access(remote);
  throw new Error("remote.json 已存在，保留现有配对配置，结束互通测试");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await access(binary);
const dir = await mkdtemp(join(tmpdir(), "tandem-native-interop-"));
const bin = join(dir, "bin"),
  shell = join(dir, "shell"),
  project = join(dir, "project"),
  secondProject = join(dir, "second-project"),
  conversations = join(dir, "conversations");
const report = join(dir, "report.jsonl"),
  pairFile = join(dir, "pair.txt"),
  script = join(dir, "drive.js"),
  cliLog = join(dir, "cli.log");
const dataFile = join(dir, "tokens.json");
let relay = await startRelay({
  hostToken: "native-interop-fixture",
  dataFile,
});
const proxy = await grantProxy(() => relay.url, pairFile);
let app: ReturnType<typeof spawn> | undefined;
let restored = false;
let appErrors = "";
const nodePath = dirname(process.execPath);
const fixtureEnv = {
  ...process.env,
  PATH: `${bin}:${nodePath}:/usr/bin:/bin:/usr/sbin:/sbin`,
  ZDOTDIR: shell,
  SHELL: "/bin/zsh",
  CLAUDE_CONFIG_DIR: join(dir, "claude"),
  PI_CODING_AGENT_DIR: join(dir, "pi"),
  CODEX_HOME: join(dir, "codex"),
  TANDEM_INTEROP_PATH: `${bin}:${nodePath}:/usr/bin:/bin:/usr/sbin:/sbin`,
  TANDEM_INTEROP_CLI_LOG: cliLog,
  TANDEM_DRIVE_QUEUE_DIR: join(dir, "queues"),
  TANDEM_DRIVE_PAIR_FILE: pairFile,
  TANDEM_DRIVE_PAIR_ALLOW: "1",
  TANDEM_DRIVE_REPORT: report,
  TANDEM_DRIVE_SCRIPT: script,
};

async function reports(): Promise<any[]> {
  try {
    return (await readFile(report, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
function launch() {
  const child = spawn(binary, [], {
    env: fixtureEnv,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (data) => {
    appErrors = (appErrors + data.toString()).slice(-4000);
  });
  return child;
}
async function stopApp() {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  process.kill(-app.pid!, "SIGTERM");
  for (
    let i = 0;
    i < 50 && app.exitCode === null && app.signalCode === null;
    i++
  )
    await sleep(100);
  if (app.exitCode === null && app.signalCode === null)
    process.kill(-app.pid!, "SIGKILL");
}
try {
  for (const path of [
    bin,
    shell,
    project,
    secondProject,
    conversations,
    fixtureEnv.CLAUDE_CONFIG_DIR + "/projects/fixture",
    fixtureEnv.PI_CODING_AGENT_DIR,
    fixtureEnv.CODEX_HOME,
  ])
    await mkdir(path, { recursive: true, mode: 0o700 });
  await copyFile(
    new URL("./fixtures/codex.mjs", import.meta.url),
    join(bin, "codex"),
  );
  await chmod(join(bin, "codex"), 0o700);
  for (const cli of ["claude", "pi"])
    await writeFile(join(bin, cli), '#!/bin/sh\nprintf "0.0.0-fixture\\n"\n', {
      mode: 0o700,
    });
  for (const file of [".zshrc", ".zlogin"])
    await writeFile(join(shell, file), 'export PATH="$TANDEM_INTEROP_PATH"\n', {
      mode: 0o600,
    });
  const id = "47216dfc-a9d7-469f-9440-bb16a7235f61";
  const history = [
    {
      type: "user",
      uuid: "u1",
      parentUuid: null,
      cwd: project,
      message: { role: "user", content: "互通测试任务" },
    },
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      cwd: project,
      message: {
        id: "m1",
        role: "assistant",
        content: [{ type: "text", text: "来自测试文件的回复" }],
      },
    },
    {
      type: "user",
      uuid: "u2",
      parentUuid: "a1",
      cwd: project,
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=",
            },
          },
          { type: "text", text: "测试图片" },
        ],
      },
    },
  ];
  await writeFile(
    join(fixtureEnv.CLAUDE_CONFIG_DIR, "projects/fixture", id + ".jsonl"),
    history.map((r) => JSON.stringify(r)).join("\n") + "\n",
    { mode: 0o600 },
  );
  const conversationId = "58538522-479b-4c16-b604-77a92d1a2bc5";
  const conversationCwd = join(conversations, "previous-chat");
  await mkdir(conversationCwd);
  await writeFile(join(fixtureEnv.CLAUDE_CONFIG_DIR, "projects/fixture", conversationId + ".jsonl"),
    JSON.stringify({ type: "user", uuid: "conversation-u1", parentUuid: null, cwd: conversationCwd,
      message: { role: "user", content: "对话分组测试" } }) + "\n", { mode: 0o600 });
  const drive = `(async () => {
    const api = window.__TAURI_INTERNALS__;
    const invoke = (name,args={}) => api.invoke(name,args);
    const report = payload => invoke('plugin:event|emit',{event:'drive-report',payload});
    const marker = 'tandem.native-interop-backup';
    const restore = async () => {
      const backup = JSON.parse(sessionStorage.getItem(marker));
      localStorage.clear(); for (const [key,value] of backup) localStorage.setItem(key,value);
      sessionStorage.removeItem(marker);
      const equal = JSON.stringify(Object.entries(localStorage).sort()) === JSON.stringify(backup.sort());
      await report({stage:'restored',equal});
    };
    try {
      if (!sessionStorage.getItem(marker)) {
        const storage = Object.entries(localStorage);
        sessionStorage.setItem(marker,JSON.stringify(storage));
        await report({stage:'backup',storage});
        localStorage.clear();
        localStorage.setItem('tandem.settings',JSON.stringify({notifyWhenDone:false,keepInMenuBar:false,conversationDir:${JSON.stringify(conversations)},pastConversationDirs:[],language:'zh'}));
        localStorage.setItem('tandem.extraProjects',JSON.stringify({cwds:[${JSON.stringify(project)},${JSON.stringify(secondProject)}]}));
        localStorage.setItem('tandem.projectOrder',JSON.stringify({cwds:[${JSON.stringify(secondProject)},'tandem:conversation',${JSON.stringify(project)}]}));
        localStorage.setItem('tandem.projectsSeeded',JSON.stringify({seeded:true}));
        await report({stage:'prepared'}); return;
      }
      const handler = api.transformCallback(async (event) => {
        if(event.payload.event.type !== 'finished') return;
        setTimeout(async () => {
          try {
            const state = await invoke('remote_state');
            for (const client of state.clients) await invoke('remote_revoke',{clientId:client.clientId});
            await invoke('remote_configure',{enabled:false,relayUrl:${JSON.stringify(proxy.url)},hostToken:null});
            await restore();
          } catch(error) { await report({stage:'failed',error:String(error)}); await restore(); }
        },1500);
      },false);
      await invoke('plugin:event|listen',{event:'remote-turn',target:{kind:'Any'},handler});
      await invoke('remote_update_context',{context:{projects:[${JSON.stringify(project)},${JSON.stringify(secondProject)}],projectOrder:[${JSON.stringify(secondProject)},'tandem:conversation',${JSON.stringify(project)}],conversationRoots:[${JSON.stringify(conversations)}],conversationDir:${JSON.stringify(conversations)},archived:[],titles:{},language:'zh-CN'}});
      await invoke('remote_configure',{enabled:true,relayUrl:${JSON.stringify(proxy.url)},hostToken:'native-interop-fixture'});
      for(let n=0;n<100;n++){ if((await invoke('remote_state')).status==='online') break; await new Promise(r=>setTimeout(r,100)); }
      const pause = ms => new Promise(r => setTimeout(r,ms));
      const sections = [...document.querySelectorAll('[data-project]')];
      const projectRow = sections.find(row => row.querySelector('button[title]')?.getAttribute('title')===${JSON.stringify(secondProject)});
      const firstRow = sections.find(row => row.querySelector('button[title]')?.getAttribute('title')===${JSON.stringify(project)});
      if(!projectRow || !firstRow) throw new Error('Fixture projects missing from sidebar');
      const heading = projectRow.querySelector('[data-project-handle]') || projectRow.firstElementChild;
      const start = heading.getBoundingClientRect();
      const end = firstRow.getBoundingClientRect();
      heading.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:start.x+50,clientY:start.y+start.height/2}));
      window.dispatchEvent(new PointerEvent('pointermove',{clientX:start.x+50,clientY:end.bottom+20}));
      window.dispatchEvent(new PointerEvent('pointerup',{button:0,clientX:start.x+50,clientY:end.bottom+20}));
      await pause(100);
      const order = JSON.parse(localStorage.getItem('tandem.projectOrder')).cwds;
      if(JSON.stringify(order)!==JSON.stringify(['tandem:conversation',${JSON.stringify(project)},${JSON.stringify(secondProject)}])) throw new Error('Sidebar drag did not update saved order');
      await report({stage:'project-reordered'});
      const hidden = async () => { if((await invoke('remote_state')).pairing) throw new Error('Pairing visible before acknowledgement'); };
      const timed = invoke('remote_begin_pairing');
      await pause(100); await hidden();
      let timedOut = false; try { await timed; } catch { timedOut = true; }
      if(!timedOut) throw new Error('Missing acknowledgement accepted');
      await hidden(); await report({stage:'ack-timeout'});
      for(let n=0;n<150;n++){ if((await invoke('remote_state')).status==='online') break; await pause(100); }
      const canceled = invoke('remote_begin_pairing');
      await pause(100); await hidden(); await invoke('remote_cancel_pairing');
      let canceledOk = false; try { await canceled; } catch { canceledOk = true; }
      if(!canceledOk) throw new Error('Canceled pairing accepted');
      await hidden(); await report({stage:'ack-canceled'});
      const registered = invoke('remote_begin_pairing');
      await pause(100); await hidden(); await registered;
      if(!(await invoke('remote_state')).pairing) throw new Error('Acknowledged pairing hidden');
      await report({stage:'ready'});
      setTimeout(async () => { if(sessionStorage.getItem(marker)){ await report({stage:'failed',error:'Interop deadline'});await restore(); } },45000);
    } catch(error) { await report({stage:'failed',error:String(error)}); if(sessionStorage.getItem(marker)) await restore(); }
  })();`;
  await writeFile(script, drive, { mode: 0o600 });
  new Function(drive);
  app = launch();
  for (let i = 0; i < 100; i++) {
    if ((await reports()).some((r) => r.stage === "prepared")) break;
    await sleep(100);
  }
  const backup = (await reports()).find((r) => r.stage === "backup")?.storage;
  assert.ok(backup, "调试页面已保存 localStorage");
  await sleep(500);
  await stopApp();
  const runDrive = drive
    .replace(
      "const marker = 'tandem.native-interop-backup';",
      "const marker = 'tandem.native-interop-backup'; sessionStorage.setItem(marker, JSON.stringify(" +
        JSON.stringify(backup) +
        "));",
    )
    .replace("if (!sessionStorage.getItem(marker)) {", "if (false) {");
  await writeFile(script, runDrive, { mode: 0o600 });
  app = launch();
  for (let i = 0; i < 400; i++) {
    const data = await reports();
    if (data.some((r) => r.stage === "failed"))
      throw new Error("桌面端确认流程失败");
    if (data.some((r) => r.stage === "ready")) break;
    await sleep(100);
  }
  assert.ok(
    (await reports()).some((r) => r.stage === "ready"),
    "桌面端登记确认后准备就绪",
  );
  await desktopInterop(root, pairFile, {
    expectedProjects: ["tandem:conversation", project, secondProject],
    expectedConversationRoot: conversations,
    restartRelay: async () => {
      const before = proxy.counts().syncs;
      await relay.close();
      await rm(dataFile);
      relay = await startRelay({
        hostToken: "native-interop-fixture",
        dataFile,
      });
      for (let i = 0; i < 200 && proxy.counts().syncs === before; i++)
        await sleep(100);
      assert.ok(
        proxy.counts().syncs > before,
        "丢失准入文件后桌面端完成重新登记和同步",
      );
      const saved = JSON.parse(await readFile(dataFile, "utf8"));
      assert.ok(Object.keys(saved).length > 0, "恢复的长期准入已落盘");
    },
  });
  proxy.verify();
  assert.equal(proxy.counts().pairingGrants, 3);
  assert.ok(proxy.counts().permanentGrants >= 2);
  assert.ok(proxy.counts().disconnects >= 2);
  for (let i = 0; i < 100; i++) {
    const data = await reports();
    if (data.some((r) => r.stage === "restored" && r.equal)) {
      restored = true;
      break;
    }
    await sleep(100);
  }
  const data = await reports();
  assert.deepEqual(
    data.filter((r) => r.stage === "failed"),
    [],
  );
  assert.ok(restored, "页面 localStorage 已恢复");
  const cli = await readFile(cliLog, "utf8");
  assert.ok(cli.includes("answered"));
  assert.ok(data.some((r) => r.stage === "ack-timeout"));
  assert.ok(data.some((r) => r.stage === "ack-canceled"));
  assert.ok(data.some((r) => r.stage === "project-reordered"));
  console.log(
    "真实桌面端互通通过；确认延迟/超时/取消、逻辑断连、令牌重登记、计时与 localStorage 恢复已验证。",
  );
} catch (error) {
  console.error(
    "native driver",
    (await reports()).filter((r) => r.stage !== "backup"),
  );
  console.error("native process", app?.exitCode, app?.signalCode, appErrors);
  console.error("relay events", relay.logs());
  throw error;
} finally {
  await stopApp();
  if (!restored) {
    const backup = (await reports()).find((r) => r.stage === "backup")?.storage;
    if (backup) {
      await writeFile(
        script,
        `(async()=>{const backup=${JSON.stringify(backup)};localStorage.clear();for(const [k,v]of backup)localStorage.setItem(k,v);await window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'drive-report',payload:{stage:'restored',equal:JSON.stringify(Object.entries(localStorage).sort())===JSON.stringify(backup.sort())}});})();`,
        { mode: 0o600 },
      );
      app = launch();
      for (let i = 0; i < 100; i++) {
        if ((await reports()).some((r) => r.stage === "restored" && r.equal)) {
          restored = true;
          break;
        }
        await sleep(100);
      }
      await stopApp();
    } else restored = true;
  }
  await proxy.close();
  await relay.close();
  await rm(remote, { force: true });
  if (restored) await rm(dir, { recursive: true, force: true });
  else throw new Error("localStorage 恢复报告保留在 " + report);
}
