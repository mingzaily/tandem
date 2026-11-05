import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createRelay, tokenHash } from "../src/server.ts";
import { fakeHost } from "../dev/fake-host.ts";
import { Client } from "../../pwa/src/lib/client.ts";
import { parsePairCode } from "../../pwa/src/lib/pairing.ts";

async function fixture(t: any, helloMs = 10_000) {
  const dir = await mkdtemp(join(tmpdir(), "tandem-relay-"));
  const file = join(dir, "tokens.json");
  const relay = await createRelay({
    hostToken: "test-host",
    dataFile: file,
    helloMs,
  });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  const url = `ws://127.0.0.1:${(relay.server.address() as any).port}/ws`;
  t.after(async () => {
    await relay.close();
    await rm(dir, { recursive: true });
  });
  return { url, file, relay };
}
function inbox(ws: WebSocket) {
  const messages: any[] = [];
  const waits: ((f: any) => void)[] = [];
  ws.on("message", (raw) => {
    const f = JSON.parse(raw.toString());
    const wait = waits.shift();
    if (wait) wait(f);
    else messages.push(f);
  });
  return () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise<any>((r) => waits.push(r));
}
async function socket(url: string) {
  const ws = new WebSocket(url);
  const next = inbox(ws);
  await once(ws, "open");
  return { ws, next, send: (f: object) => ws.send(JSON.stringify(f)) };
}
const room = Buffer.alloc(16, 1).toString("base64url"),
  token = Buffer.alloc(32, 2).toString("base64url");
test(
  "准入令牌一次使用、过期、撤销与 hash 持久化",
  { timeout: 10_000 },
  async (t) => {
    const { url, file } = await fixture(t);
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    const hash = tokenHash(token);
    host.send({
      t: "allow",
      tokenHash: hash,
      oneTime: true,
      expiresAt: Date.now() + 10_000,
    });
    const first = await socket(url);
    first.send({ t: "client-hello", v: 1, room, token });
    assert.equal((await first.next()).t, "hello-ack");
    const replay = await socket(url);
    replay.send({ t: "client-hello", v: 1, room, token });
    assert.equal((await once(replay.ws, "close"))[0], 4401);
    const expToken = Buffer.alloc(32, 3).toString("base64url");
    host.send({
      t: "allow",
      tokenHash: tokenHash(expToken),
      oneTime: true,
      expiresAt: Date.now() + 30,
    });
    await new Promise((r) => setTimeout(r, 50));
    const expired = await socket(url);
    expired.send({ t: "client-hello", v: 1, room, token: expToken });
    assert.equal((await once(expired.ws, "close"))[0], 4401);
    host.send({ t: "allow", tokenHash: hash, oneTime: false, expiresAt: null });
    // 后续同 socket 的帧在持久化完成后处理。
    host.send({ t: "data", to: "missing", d: "" });
    for (let n = 0; n < 100; n++) {
      try {
        await readFile(file);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    const stored = await readFile(file, "utf8");
    assert.ok(stored.includes(hash));
    assert.ok(!stored.includes(token));
    const revoked = once(first.ws, "close");
    host.send({ t: "revoke", tokenHash: hash });
    assert.equal((await revoked)[0], 4410);
  },
);
test(
  "真实 relay + fake-host + PWA 协议层完成配对、重连、流式、确认、提问和撤销",
  { timeout: 15_000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await fakeHost(url, "test-host", async () => true);
    t.after(() => host.close());
    const client = new Client();
    t.after(() => client.close());
    let pairingCode = "";
    client.onCode = (value) => (pairingCode = value);
    const identity = await client.pair(
      parsePairCode(host.pairCode),
      "测试手机",
    );
    assert.match(pairingCode, /^\d{6}$/);
    function ready() {
      return new Promise<void>((resolve, reject) => {
        client.onError = reject;
        client.onStatus = (s) => {
          if (s === "ready") resolve();
        };
        client.connect(identity);
      });
    }
    await ready();
    assert.equal((await client.request("tasks.list")).tasks[0].id, "demo");
    const events: any[] = [];
    client.onEvent = (f) => {
      if (f.ev === "turn.event") events.push(f.p.event);
    };
    const wait = async (type: string) => {
      for (let n = 0; n < 200; n++) {
        const e = events.find((e) => e.type === type);
        if (e) return e;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("等待事件超时: " + type);
    };
    await client.request("turn.send", {
      agent: "claude",
      taskId: "demo",
      cwd: null,
      prompt: "你好",
      model: "demo",
      effort: "medium",
      permissionMode: "default",
    });
    const permission = await wait("permissionRequest");
    assert.ok(events.some((e) => e.type === "textDelta"));
    await ready();
    const snapshot = await client.request("live.snapshot");
    assert.equal(snapshot.runs[0].events.at(-1).type, "permissionRequest");
    await client.request("request.answer", {
      taskId: "demo",
      requestId: permission.requestId,
      decision: { kind: "allow" },
    });
    const question = await wait("question");
    await client.request("request.answer", {
      taskId: "demo",
      requestId: question.requestId,
      decision: { kind: "answer", answers: { "下一步做什么？": "完成" } },
    });
    await wait("finished");
    assert.ok(
      (
        await client.request("task.read", { agent: "claude", id: "demo" })
      ).messages.some((m: any) => m.text.includes("你好")),
    );
    await assert.rejects(
      client.request("turn.send", {
        taskId: null,
        cwd: "/arbitrary",
        permissionMode: "bypassPermissions",
      }),
      /NOT_ALLOWED/,
    );
    const revoked = new Promise<void>((resolve) => {
      client.onStatus = (s) => {
        if (s === "revoked") resolve();
      };
    });
    host.revoke();
    await revoked;
    const ws = await socket(url);
    ws.send({
      t: "client-hello",
      v: 1,
      room: identity.room,
      token: identity.token,
    });
    assert.equal((await once(ws.ws, "close"))[0], 4401);
  },
);
test(
  "转发隔离、覆盖 from、超大帧保持连接、host 替换",
  { timeout: 10_000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    host.send({
      t: "allow",
      tokenHash: tokenHash(token),
      oneTime: false,
      expiresAt: null,
    });
    const client = await socket(url);
    client.send({ t: "client-hello", v: 1, room, token });
    const ack = await client.next();
    await host.next();
    client.send({ t: "data", from: "forged", d: "e30" });
    assert.deepEqual(await host.next(), {
      t: "data",
      from: ack.conn,
      d: "e30",
    });
    client.ws.send("x".repeat(2 * 1024 * 1024 + 1));
    assert.equal((await client.next()).code, "PAYLOAD_TOO_LARGE");
    host.send({ t: "data", to: ack.conn, d: "e30" });
    assert.deepEqual(await client.next(), { t: "data", d: "e30" });
    const closed = once(host.ws, "close");
    const replacement = await socket(url);
    replacement.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await replacement.next();
    assert.equal((await closed)[0], 4409);
    replacement.send({ t: "allow-sync", tokenHashes: [] });
    // host-online 事件先于撤销抵达。
    const revoked = await once(client.ws, "close");
    assert.equal(revoked[0], 4410);
  },
);
test("版本、准入超时和 IP 失败限制", { timeout: 10_000 }, async (t) => {
  const { url } = await fixture(t, 100);
  const version = await socket(url);
  version.send({ t: "host-hello", v: 2, room, token: "test-host" });
  assert.equal((await once(version.ws, "close"))[0], 4400);
  const idle = await socket(url);
  assert.equal((await once(idle.ws, "close"))[0], 4401);
  for (let i = 0; i < 9; i++) {
    const c = await socket(url);
    c.send({ t: "host-hello", v: 1, room, token: "bad" });
    assert.equal((await once(c.ws, "close"))[0], i === 8 ? 4429 : 4401);
  }
});
test("房间隔离和每房间八台手机上限", { timeout: 10_000 }, async (t) => {
  const { url } = await fixture(t);
  const host = await socket(url);
  host.send({ t: "host-hello", v: 1, room, token: "test-host" });
  await host.next();
  host.send({
    t: "allow",
    tokenHash: tokenHash(token),
    oneTime: false,
    expiresAt: null,
  });
  const alien = await socket(url);
  alien.send({
    t: "client-hello",
    v: 1,
    room: Buffer.alloc(16, 9).toString("base64url"),
    token,
  });
  assert.equal((await once(alien.ws, "close"))[0], 4401);
  for (let i = 0; i < 8; i++) {
    const c = await socket(url);
    c.send({ t: "client-hello", v: 1, room, token });
    assert.equal((await c.next()).t, "hello-ack");
  }
  const ninth = await socket(url);
  ninth.send({ t: "client-hello", v: 1, room, token });
  assert.equal((await once(ninth.ws, "close"))[0], 4429);
});
test(
  "持久令牌重启后恢复，HOST_OFFLINE 与重新上线",
  { timeout: 10_000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "tandem-restart-"));
    const file = join(dir, "tokens.json");
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        file,
        JSON.stringify([
          [tokenHash(token), { room, oneTime: false, expiresAt: null }],
        ]),
      ),
    );
    const relay = await createRelay({ hostToken: "test-host", dataFile: file });
    relay.server.listen(0, "127.0.0.1");
    await once(relay.server, "listening");
    t.after(async () => {
      await relay.close();
      await rm(dir, { recursive: true });
    });
    const url = `ws://127.0.0.1:${(relay.server.address() as any).port}/ws`;
    const client = await socket(url);
    client.send({ t: "client-hello", v: 1, room, token });
    assert.equal((await client.next()).hostOnline, false);
    client.send({ t: "data", d: "e30" });
    assert.equal((await client.next()).code, "HOST_OFFLINE");
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    assert.deepEqual(await client.next(), { t: "host", online: true });
    const next = client.next();
    host.ws.close();
    assert.deepEqual(await next, { t: "host", online: false });
  },
);
