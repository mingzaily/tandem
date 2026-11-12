import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startRelay } from "../dev/rust-relay.ts";
import { tokenHash } from "../dev/tokens.ts";
import { fakeHost } from "../dev/fake-host.ts";
import { Client } from "../../pwa/src/lib/client.ts";
import { TaskCreation } from "../../pwa/src/lib/creation.ts";
import { parsePairCode } from "../../pwa/src/lib/pairing.ts";

async function fixture(t: any, helloMs = 10_000) {
  const dir = await mkdtemp(join(tmpdir(), "tandem-relay-"));
  const file = join(dir, "tokens.json");
  const relay = await startRelay({
    hostToken: "test-host",
    dataFile: file,
    helloMs,
  });
  const url = relay.url;
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
test("握手和健康检查报告 relay 版本，协议版本保持独立", { timeout: 5000 }, async (t) => {
  const { url } = await fixture(t);
  const host = await socket(url);
  t.after(() => host.ws.close());
  host.send({ t: "host-hello", v: 1, room, token: "test-host" });
  const ack = await host.next();
  const healthUrl = new URL(url.replace(/^ws:/, "http:"));
  healthUrl.pathname = "/healthz";
  const health = await (await fetch(healthUrl)).json();
  const cargo = await readFile(new URL("../Cargo.toml", import.meta.url), "utf8");
  const version = /^version = "([^"]+)"/m.exec(cargo)![1];
  assert.equal(ack.t, "hello-ack");
  assert.equal(ack.relayVersion, version);
  assert.equal(health.version, version);
  assert.equal(health.v, 1);
});

test(
  "相对配对期限支持完整五分钟，并按中转时间过期",
  { timeout: 5000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    for (const [id, ttlMs] of [
      ["full", 300_000],
      ["short", 25],
    ] as const) {
      const value = Buffer.alloc(32, id === "full" ? 21 : 22).toString(
        "base64url",
      );
      host.send({
        t: "allow",
        id,
        tokenHash: tokenHash(value),
        oneTime: true,
        ttlMs,
      });
      assert.deepEqual(await host.next(), { t: "allow-ack", id });
      if (id === "short") await new Promise((r) => setTimeout(r, 50));
      const client = await socket(url);
      const closed = once(client.ws, "close");
      client.send({ t: "client-hello", v: 1, room, token: value });
      if (id === "full") {
        assert.equal((await client.next()).t, "hello-ack");
        client.ws.close();
        await closed;
        while ((await host.next()).online !== false) {}
      } else assert.equal((await closed)[0], 4401);
    }
  },
);
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
      permissionMode: null,
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
        permissionMode: null,
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
  "首次握手被 disconnect 后，PWA 保留配对身份并自动重连",
  { timeout: 10000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await fakeHost(url, "test-host", async () => true, {
      disconnectFirstHandshake: true,
    });
    t.after(() => host.close());
    const sockets: globalThis.WebSocket[] = [];
    const closeCodes: number[] = [];
    const client = new Client((address) => {
      const ws = new globalThis.WebSocket(address);
      ws.addEventListener("close", (event) => closeCodes.push(event.code));
      sockets.push(ws);
      return ws;
    });
    t.after(() => client.close());
    const identity = await client.pair(
      parsePairCode(host.pairCode),
      "重连测试手机",
    );
    const statuses: string[] = [];
    await new Promise<void>((resolve, reject) => {
      client.onError = reject;
      client.onStatus = (status) => {
        statuses.push(status);
        if (status === "ready") resolve();
      };
      client.connect(identity);
    });
    assert.equal(
      sockets.length,
      3,
      "一次配对、首次握手和自动重连各使用一条连接",
    );
    assert.ok(closeCodes.includes(4411));
    assert.deepEqual(statuses, [
      "closed",
      "connecting",
      "offline",
      "connecting",
      "ready",
    ]);
    assert.equal((await client.request("tasks.list")).tasks[0].id, "demo");
  },
);
test(
  "fake-host 对未知身份关闭 4410，其他已配对连接继续可用",
  { timeout: 5000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await fakeHost(url, "test-host", async () => true);
    t.after(() => host.close());
    const client = new Client();
    t.after(() => client.close());
    const identity = await client.pair(
      parsePairCode(host.pairCode),
      "身份测试手机",
    );
    const codes: number[] = [];
    const unknown = new Client((address) => {
      const socket = new globalThis.WebSocket(address);
      socket.addEventListener("close", (event) => codes.push(event.code));
      return socket;
    });
    t.after(() => unknown.close());
    await new Promise<void>((resolve, reject) => {
      unknown.onError = reject;
      unknown.onStatus = (status) => {
        if (status === "revoked") resolve();
      };
      unknown.connect({
        ...identity,
        clientId: Buffer.alloc(16, 42).toString("base64url"),
      });
    });
    assert.deepEqual(codes, [4410]);
    await new Promise<void>((resolve, reject) => {
      client.onError = reject;
      client.onStatus = (status) => {
        if (status === "ready") resolve();
      };
      client.connect(identity);
    });
    const info = await client.request("host.info");
    assert.deepEqual(
      info.projects.map((project: any) => project.cwd),
      ["/notes", "tandem:conversation", "/demo"],
    );
    assert.deepEqual(info.conversationRoots, [
      "/conversations",
      "/past-conversations",
    ]);
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
    const relay = await startRelay({ hostToken: "test-host", dataFile: file });
    t.after(async () => {
      await relay.close();
      await rm(dir, { recursive: true });
    });
    const url = relay.url;
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

test("准入帧和硬上限在帧头处拒绝，不等待正文", { timeout: 5000 }, async (t) => {
  const { url } = await fixture(t);
  const unauthenticated = await socket(url);
  const failed = once(unauthenticated.ws, "close");
  (unauthenticated.ws as any)._socket.write(
    Buffer.from([0x81, 0xfe, 0x10, 0x01, 0, 0, 0, 0]),
  );
  assert.equal((await failed)[0], 4401);
  const host = await socket(url);
  host.send({ t: "host-hello", v: 1, room, token: "test-host" });
  await host.next();
  const header = Buffer.alloc(14);
  header[0] = 0x81;
  header[1] = 0xff;
  header.writeBigUInt64BE(BigInt(4 * 1024 * 1024 + 1), 2);
  const closed = once(host.ws, "close");
  (host.ws as any)._socket.write(header);
  assert.equal((await closed)[0], 1009);
});

test("全局连接上限包括尚未准入的连接", { timeout: 10000 }, async (t) => {
  const { url } = await fixture(t);
  const pending = await Promise.all(
    Array.from({ length: 256 }, () => socket(url)),
  );
  const overflow = await socket(url);
  assert.equal((await once(overflow.ws, "close"))[0], 4429);
  assert.equal(
    pending.filter((p) => p.ws.readyState === WebSocket.OPEN).length,
    256,
  );
});

test(
  "allow 确认在长期令牌落盘后返回，disconnect 限定本房间",
  { timeout: 5000 },
  async (t) => {
    const { url, file, relay } = await fixture(t);
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    host.send({
      t: "allow",
      id: "grant-1",
      tokenHash: tokenHash(token),
      oneTime: false,
      expiresAt: null,
    });
    assert.deepEqual(await host.next(), { t: "allow-ack", id: "grant-1" });
    assert.equal(
      JSON.parse(await readFile(file, "utf8"))[0][0],
      tokenHash(token),
    );
    const client = await socket(url);
    client.send({ t: "client-hello", v: 1, room, token });
    const ack = await client.next();
    await host.next();
    const alien = await socket(url);
    alien.send({
      t: "host-hello",
      v: 1,
      room: Buffer.alloc(16, 9).toString("base64url"),
      token: "test-host",
    });
    await alien.next();
    alien.send({ t: "disconnect", conn: ack.conn, code: 4410 });
    host.send({ t: "data", to: ack.conn, d: "c2VjcmV0" });
    assert.deepEqual(await client.next(), { t: "data", d: "c2VjcmV0" });
    const closed = once(client.ws, "close");
    host.send({ t: "disconnect", conn: ack.conn });
    assert.equal((await closed)[0], 4411);
    const restored = await socket(url);
    restored.send({ t: "client-hello", v: 1, room, token });
    const restoredAck = await restored.next();
    assert.equal(restoredAck.t, "hello-ack");
    assert.notEqual(restoredAck.conn, ack.conn);
    assert.equal(relay.logs().includes("test-host"), false);
    assert.equal(relay.logs().includes(token), false);
    assert.equal(relay.logs().includes("c2VjcmV0"), false);
  },
);

test(
  "可信代理按 X-Forwarded-For 最后一段限流",
  { timeout: 5000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "tandem-proxy-"));
    const relay = await startRelay({
      hostToken: "test-host",
      dataFile: join(dir, "tokens.json"),
      trustProxy: true,
    });
    t.after(async () => {
      await relay.close();
      await rm(dir, { recursive: true });
    });
    for (let i = 0; i < 10; i++) {
      const ws = new WebSocket(relay.url, {
        headers: { "X-Forwarded-For": `${i}, 198.51.100.10` },
      });
      await once(ws, "open");
      const closed = once(ws, "close");
      ws.send(JSON.stringify({ t: "host-hello", v: 1, room, token: "bad" }));
      assert.equal((await closed)[0], i === 9 ? 4429 : 4401);
    }
    const ws = new WebSocket(relay.url, {
      headers: { "X-Forwarded-For": "198.51.100.10, 198.51.100.11" },
    });
    const next = inbox(ws);
    await once(ws, "open");
    ws.send(
      JSON.stringify({ t: "host-hello", v: 1, room, token: "test-host" }),
    );
    assert.equal((await next()).t, "hello-ack");
  },
);

test(
  "disconnect 区分可重连会话与需要重新配对的设备",
  { timeout: 5000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    host.send({
      t: "allow",
      id: "grant",
      tokenHash: tokenHash(token),
      oneTime: false,
      expiresAt: null,
    });
    await host.next();
    for (const code of [4411, 4410]) {
      const client = await socket(url);
      client.send({ t: "client-hello", v: 1, room, token });
      const ack = await client.next();
      while ((await host.next()).online !== true) {}
      const closed = once(client.ws, "close");
      host.send({ t: "disconnect", conn: ack.conn, code });
      assert.equal((await closed)[0], code);
    }
  },
);

test(
  "损坏的准入文件在启动日志中报告路径与恢复办法",
  { timeout: 5000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "tandem-corrupt-grants-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "tokens.json");
    for (const content of [
      '{"secret":"private-fixture"',
      '[{"secret":"private-fixture"}]',
    ]) {
      await writeFile(file, content);
      await assert.rejects(
        startRelay({ hostToken: "test-host", dataFile: file }),
        (error: Error) => {
          assert.ok(error.message.includes(file));
          assert.match(error.message, /备份/);
          assert.match(error.message, /重新登记/);
          assert.equal(error.message.includes("private-fixture"), false);
          return true;
        },
      );
    }
  },
);

test(
  "准入文件读取失败有恢复提示，改名后重连可重新登记原令牌",
  { timeout: 10000 },
  async (t) => {
    for (const unreadable of [false, true]) {
      const dir = await mkdtemp(join(tmpdir(), "tandem-grants-recovery-"));
      t.after(() => rm(dir, { recursive: true, force: true }));
      const file = join(dir, "tokens.json");
      if (unreadable) await mkdir(file);
      else await writeFile(file, "{broken grants");
      await assert.rejects(
        startRelay({ hostToken: "test-host", dataFile: file }),
        (error: Error) => {
          assert.ok(error.message.includes(file));
          assert.match(error.message, /重新登记/);
          if (unreadable) assert.match(error.message, /改名.*重启/);
          return true;
        },
      );
      await rename(file, `${file}.corrupt`);
      if (!unreadable)
        assert.equal(
          await readFile(`${file}.corrupt`, "utf8"),
          "{broken grants",
        );
      const relay = await startRelay({
        hostToken: "test-host",
        dataFile: file,
      });
      t.after(() => relay.close());
      const host = await socket(relay.url);
      host.send({ t: "host-hello", v: 1, room, token: "test-host" });
      assert.equal((await host.next()).t, "hello-ack");
      // The desktop's restore_clients sends this registration on every reconnect.
      host.send({
        t: "allow",
        id: "restore",
        tokenHash: tokenHash(token),
        oneTime: false,
        expiresAt: null,
      });
      assert.deepEqual(await host.next(), { t: "allow-ack", id: "restore" });
      host.send({ t: "allow-sync", tokenHashes: [tokenHash(token)] });
      const client = await socket(relay.url);
      client.send({ t: "client-hello", v: 1, room, token });
      const ack = await client.next();
      assert.equal(ack.t, "hello-ack");
      assert.equal(ack.hostOnline, true);
      assert.equal(
        JSON.parse(await readFile(file, "utf8"))[0][0],
        tokenHash(token),
      );
      await relay.close();
    }
  },
);

test(
  "host data 必须带 to，配对令牌存活至多五分钟",
  { timeout: 5000 },
  async (t) => {
    const { url } = await fixture(t);
    for (const frame of [
      { t: "data", d: "" },
      {
        t: "allow",
        tokenHash: tokenHash(token),
        oneTime: true,
        expiresAt: Date.now() + 600_000,
      },
      {
        t: "allow",
        tokenHash: tokenHash(token),
        oneTime: false,
        expiresAt: Date.now() + 100_000,
      },
      { t: "allow-sync", tokenHashes: ["BAD"] },
      { t: "revoke", tokenHash: "BAD" },
      { t: "disconnect", conn: "unknown", code: 4400 },
    ]) {
      const host = await socket(url);
      host.send({ t: "host-hello", v: 1, room, token: "test-host" });
      await host.next();
      const closed = once(host.ws, "close");
      host.send(frame);
      assert.equal((await closed)[0], 4400);
    }
  },
);

for (const operation of ["revoke", "disconnect"] as const) {
  test(
    `${operation} 先发送已排队的最终回复，再发送关闭帧`,
    { timeout: 5000 },
    async (t) => {
      const { url } = await fixture(t);
      const host = await socket(url);
      host.send({ t: "host-hello", v: 1, room, token: "test-host" });
      await host.next();
      host.send({
        t: "allow",
        id: "grant",
        tokenHash: tokenHash(token),
        oneTime: false,
        expiresAt: null,
      });
      await host.next();
      const client = await socket(url);
      client.send({ t: "client-hello", v: 1, room, token });
      const ack = await client.next();
      await host.next();
      const frames: any[] = [];
      client.ws.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
      const closed = once(client.ws, "close");
      host.send({ t: "data", to: ack.conn, d: "ZmluYWw" });
      host.send(
        operation === "revoke"
          ? { t: "revoke", tokenHash: tokenHash(token) }
          : { t: "disconnect", conn: ack.conn },
      );
      assert.equal((await closed)[0], operation === "revoke" ? 4410 : 4411);
      assert.deepEqual(frames, [{ t: "data", d: "ZmluYWw" }]);
    },
  );
}

test(
  "WebSocket 自动回复 ping，超大二进制帧保留连接",
  { timeout: 5000 },
  async (t) => {
    const { url } = await fixture(t);
    const host = await socket(url);
    host.send({ t: "host-hello", v: 1, room, token: "test-host" });
    await host.next();
    const pong = once(host.ws, "pong");
    host.ws.ping("heartbeat");
    assert.equal((await pong)[0].toString(), "heartbeat");
    host.ws.send(Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.equal((await host.next()).code, "PAYLOAD_TOO_LARGE");
    host.send({
      t: "allow",
      id: "still-open",
      tokenHash: tokenHash(token),
      oneTime: false,
      expiresAt: null,
    });
    assert.equal((await host.next()).id, "still-open");
  },
);

test(
  "新建应答早于原生登记时手机从 started 进入任务并保留确认卡",
  { timeout: 10_000 },
  async (t) => {
    const { url } = await fixture(t);
    let release!: () => void;
    const registered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = await fakeHost(url, "test-host", async () => true, {
      newTaskReady: registered,
    });
    t.after(() => host.close());
    const client = new Client();
    t.after(() => client.close());
    const identity = await client.pair(
      parsePairCode(host.pairCode),
      "new-task-phone",
    );
    await new Promise<void>((resolve, reject) => {
      client.onError = reject;
      client.onStatus = (status) => {
        if (status === "ready") resolve();
      };
      client.connect(identity);
    });
    const creation = new TaskCreation();
    creation.begin({ agent: "pi", cwd: "/demo", prompt: "new task" });
    let started!: () => void;
    let waiting!: (frame: any) => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const permission = new Promise<any>((resolve) => {
      waiting = resolve;
    });
    client.onEvent = (frame) => {
      if (frame.ev !== "turn.event") return;
      creation.receive(frame.p);
      if (frame.p.event.type === "started") {
        assert.equal(frame.p.agent, "pi");
        assert.equal(frame.p.prompt, "new task");
        started();
      }
      if (frame.p.event.type === "permissionRequest") waiting(frame.p);
    };
    const { runId } = await client.request("turn.send", {
      agent: "pi",
      taskId: null,
      cwd: "/demo",
      prompt: "new task",
      model: "demo",
      effort: "high",
      permissionMode: null,
    });
    creation.accept(runId);
    const early = await client.request("tasks.list");
    const snapshot = await client.request("live.snapshot");
    assert.equal(
      snapshot.runs.find((run: any) => run.runId === runId).taskId,
      null,
    );
    assert.deepEqual(creation.resolve(early.tasks), {});
    release();
    await began;
    const result = creation.resolve(early.tasks);
    assert.equal(result.task?.agent, "pi");
    assert.equal(result.task?.title, "new task");
    assert.equal(
      result.readHistory,
      false,
      "首屏展示实时内容，不提前读尚未登记的原生记录",
    );
    const card = await permission;
    assert.equal(card.taskId, result.task?.id);
    const content = await client.request("task.read", {
      agent: "pi",
      id: card.taskId,
    });
    assert.deepEqual(content.modelSelection, { model: "demo", effort: "high" });
    assert.equal(content.permissionMode, "default");
    await client.request("request.answer", {
      taskId: card.taskId,
      requestId: card.event.requestId,
      decision: { kind: "deny" },
    });
  },
);
