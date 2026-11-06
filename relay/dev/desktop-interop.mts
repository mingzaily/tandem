// Exercise a real debug desktop through the PWA protocol with deterministic fixture CLIs.
// Arguments: <repo root> <pairing text file>. The page driver revokes after the finished event.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { WebSocket } from "ws";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
export async function desktopInterop(
  base: string,
  pairFile: string,
  hooks: {
    restartRelay?: () => Promise<void>;
    expectedProjects?: string[];
    expectedConversationRoot?: string;
  } = {},
) {
  const { Client } = await import(base + "/pwa/src/lib/client.ts");
  const { parsePairCode } = await import(base + "/pwa/src/lib/pairing.ts");
  async function waitFor<T>(
    read: () => T | Promise<T>,
    label: string,
    attempts = 120,
  ): Promise<NonNullable<T>> {
    for (let n = 0; n < attempts; n++) {
      const value = await read();
      if (value) return value as NonNullable<T>;
      await sleep(100);
    }
    throw new Error("等待超时：" + label);
  }
  const pair = await waitFor(async () => {
    try {
      return await readFile(pairFile, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw e;
    }
  }, "配对码");
  const client = new Client();
  const statuses: string[] = [],
    events: any[] = [],
    codes: string[] = [],
    errors: Error[] = [];
  client.onStatus = (s: string) => statuses.push(s);
  client.onEvent = (e: any) => events.push(e);
  client.onCode = (code: string) => codes.push(code);
  client.onError = (error: Error) => errors.push(error);
  try {
    const identity = await client.pair(parsePairCode(pair), "interop-phone");
    assert.match(codes[0], /^\d{6}$/);
    client.connect(identity);
    await waitFor(() => statuses.includes("ready"), "加密连接");
    const info = await client.request("host.info");
    assert.ok(info.agents.includes("codex"));
    if (hooks.expectedProjects) {
      assert.deepEqual(info.projects.map((p: any) => p.cwd), hooks.expectedProjects,
        "host.info follows the sidebar drag order");
    }
    if (hooks.expectedConversationRoot) {
      assert.ok(info.conversationRoots.includes(hooks.expectedConversationRoot));
    }
    const list = await client.request("tasks.list");
    if (hooks.expectedConversationRoot) {
      const { groupTasks } = await import(base + "/pwa/src/lib/tasks.ts");
      const groups = groupTasks(list.tasks, info.projects.map((p: any) => p.cwd), info.conversationRoots);
      assert.ok(groups.find(([cwd]: [string, unknown]) => cwd === "tandem:conversation")?.[1].length,
        "native conversation folders share the conversation group in PWA");
    }
    const claude = list.tasks.find((t: any) => t.agent === "claude" &&
      !info.conversationRoots.some((root: string) => t.cwd === root || t.cwd.startsWith(root + "/")));
    assert.ok(claude);
    const page = await client.request("task.read", {
      agent: "claude",
      id: claude.id,
      limit: 3,
    });
    assert.equal(page.messages.length, 3);
    assert.ok(page.messages.some((m: any) => m.image === "omitted"));
    const models = await client.request("agent.info", { agent: "codex" });
    assert.ok(models.models.some((m: any) => m.defaultEffort === "medium"));
    for (const params of [
      {
        agent: "codex",
        taskId: null,
        cwd: "/etc",
        prompt: "x",
        model: null,
        effort: null,
        permissionMode: null,
      },
      {
        agent: "codex",
        taskId: null,
        cwd: null,
        prompt: "x",
        model: null,
        effort: null,
        permissionMode: null,
      },
      {
        agent: "codex",
        taskId: "invalid",
        cwd: null,
        prompt: " ",
        model: null,
        effort: null,
        permissionMode: null,
      },
    ])
      await assert.rejects(client.request("turn.send", params));
    await assert.rejects(client.request("nope.op"));
    const cwd = info.projects.find(
      (p: any) => p.cwd === "tandem:conversation",
    ).cwd;
    const sent = await client.request("turn.send", {
      agent: "codex",
      taskId: null,
      cwd,
      prompt: "手机发的",
      model: null,
      effort: null,
      permissionMode: "bypassPermissions",
    });
    const question = await waitFor(
      () =>
        events.find(
          (e) =>
            e.ev === "turn.event" &&
            e.p.runId === sent.runId &&
            e.p.event.type === "question",
        ),
      "提问",
    );
    const snapshot = await client.request("live.snapshot");
    const run = snapshot.runs.find((r: any) => r.runId === sent.runId);
    assert.ok(run);
    assert.equal(run.startedAtMs, question.p.startedAtMs);
    assert.ok(run.elapsedMs >= question.p.elapsedMs);
    await sleep(1200);
    client.close();
    if (hooks.restartRelay) await hooks.restartRelay();
    const readyBefore = statuses.filter((s) => s === "ready").length;
    client.connect(identity);
    await waitFor(
      () => statuses.filter((s) => s === "ready").length > readyBefore,
      "重新加密连接",
    );
    const recovered = (await client.request("live.snapshot")).runs.find(
      (r: any) => r.runId === sent.runId,
    );
    assert.equal(recovered.startedAtMs, run.startedAtMs);
    assert.ok(
      recovered.elapsedMs >= run.elapsedMs + 1000,
      "重连保留原轮次和运行时长",
    );
    const { generate, pub, b64 } = await import(
      base + "/pwa/src/lib/crypto.ts"
    );
    let unpairedStatus = "";
    const unpairedCodes: number[] = [];
    let unpairedAttempts = 0;
    const unpaired = new Client((url: string) => {
      unpairedAttempts++;
      const socket = new globalThis.WebSocket(url);
      socket.addEventListener("close", (event) => unpairedCodes.push(event.code));
      return socket;
    });
    try {
      unpaired.onStatus = (status: string) => { unpairedStatus = status; };
      unpaired.connect({ ...identity, clientId: b64(new Uint8Array(16).fill(42)) });
      await waitFor(() => unpairedStatus === "revoked", "未知身份进入重新配对状态");
      await sleep(1600);
      assert.deepEqual(unpairedCodes, [4410]);
      assert.equal(unpairedAttempts, 1, "unknown identities do not reconnect");
    } finally {
      unpaired.close();
    }
    for (const violation of ["order", "signature"]) {
      const bad = new WebSocket(identity.relay);
      const closed = once(bad, "close");
      try {
        await once(bad, "open");
        bad.send(
          JSON.stringify({
            t: "client-hello",
            v: 1,
            room: identity.room,
            token: identity.token,
          }),
        );
        await once(bad, "message");
        const data = (value: object) =>
          bad.send(
            JSON.stringify({
              t: "data",
              d: Buffer.from(JSON.stringify(value)).toString("base64url"),
            }),
          );
        if (violation === "signature") {
          const ephemeral = await generate("ECDH");
          data({
            k: "hello1",
            v: 1,
            clientId: identity.clientId,
            e: b64(await pub(ephemeral)),
          });
          await once(bad, "message");
        }
        data({ k: "hello3", sig: b64(new Uint8Array(64)) });
        assert.equal(
          (await closed)[0],
          4411,
          "桌面端释放握手顺序或签名违规的连接",
        );
      } finally {
        bad.close();
      }
    }
    for (const violation of ["counter", "cipher"]) {
      let socket!: WebSocket;
      let ready = false;
      const malformed = new Client((url: string) => {
        socket = new WebSocket(url);
        const send = socket.send.bind(socket);
        socket.send = (data: any) => {
          const frame = JSON.parse(String(data));
          if (frame.t === "data") {
            const message = JSON.parse(
              Buffer.from(frame.d, "base64url").toString(),
            );
            if (message.k === "m") {
              if (violation === "counter") message.n++;
              else message.c = b64(new Uint8Array(32));
              frame.d = Buffer.from(JSON.stringify(message)).toString(
                "base64url",
              );
            }
          }
          send(JSON.stringify(frame));
        };
        return socket;
      });
      try {
        malformed.onStatus = (status: string) => {
          if (status === "ready") ready = true;
        };
        malformed.connect(identity);
        await waitFor(() => ready, "违规密文测试握手");
        const closed = once(socket, "close");
        await assert.rejects(malformed.request("host.info"));
        assert.equal(
          (await closed)[0],
          4411,
          "桌面端释放计数器或密文违规的连接",
        );
      } finally {
        malformed.close();
      }
    }
    assert.ok(
      (await client.request("host.info")).agents.includes("codex"),
      "其他会话继续可用",
    );
    assert.ok(events.some((e) => e.p?.event?.type === "textDelta"));
    await client.request("request.answer", {
      taskId: question.p.taskId,
      requestId: question.p.event.requestId,
      decision: { kind: "answer", answers: { "选哪个颜色？": "红" } },
    });
    await waitFor(
      () => events.some((e) => e.p?.event?.type === "finished"),
      "结束",
    );
    await waitFor(
      () => events.some((e) => e.p?.event?.type === "requestSettled"),
      "提问已处理",
    );
    const seqs = events
      .filter((e) => e.ev === "turn.event")
      .map((e) => e.p.seq);
    assert.ok(seqs.every((s, i) => i === 0 || s > seqs[i - 1]));
    await waitFor(() => statuses.includes("revoked"), "桌面端撤销");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        paired: true,
        codeDigits: 6,
        readMessages: page.messages.length,
        imageOmitted: true,
        rejectedOperations: 4,
        streamed: true,
        questionAnswered: true,
        snapshot: true,
        snapshotTimingRecovered: true,
        logicalDisconnected: true,
        unpairedDisconnected: true,
        projectOrder: true,
        conversationRoots: true,
        grantsRestored: !!hooks.restartRelay,
        sequenceOrdered: true,
        revoked: true,
      }),
    );
  } finally {
    client.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await desktopInterop(process.argv[2], process.argv[3]);
