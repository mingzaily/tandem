import { createServer } from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const MAX = 2 * 1024 * 1024;
// Above this the socket closes at once, so a frame's size is bounded before it is held in memory.
const HARD_MAX = 2 * MAX;
const MAX_HELLO_BYTES = 4096;
type Grant = { room: string; oneTime: boolean; expiresAt: number | null };
type Peer = {
  ws: WebSocket;
  id: string;
  room: string;
  host: boolean;
  hash: string;
  lastPong: number;
};
export const tokenHash = (token: string) =>
  createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex");
const digest = (text: string) => createHash("sha256").update(text).digest();
const b64 = (value: unknown, bytes: number): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]+$/.test(value) &&
  Buffer.from(value, "base64url").length === bytes &&
  Buffer.from(value, "base64url").toString("base64url") === value;
const hashValid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export async function createRelay(options: {
  hostToken: string;
  dataFile: string;
  log?: (event: string) => void;
  helloMs?: number;
  /** Set when a reverse proxy on this machine passes the client's address along. */
  trustProxy?: boolean;
}) {
  if (!options.hostToken) throw new Error("TANDEM_RELAY_HOST_TOKEN 必须设置");
  const grants = new Map<string, Grant>();
  try {
    const stored = JSON.parse(await readFile(options.dataFile, "utf8")) as [
      string,
      Grant,
    ][];
    for (const [hash, grant] of stored) {
      if (
        !hashValid(hash) ||
        !b64(grant.room, 16) ||
        grant.oneTime ||
        grant.expiresAt !== null
      )
        throw new Error("准入数据格式错误");
      grants.set(hash, grant);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let writes = Promise.resolve();
  const persist = () => {
    const content = JSON.stringify([...grants].filter(([, g]) => !g.oneTime));
    const write = writes.then(async () => {
      await mkdir(dirname(options.dataFile), { recursive: true, mode: 0o700 });
      await writeFile(options.dataFile + ".tmp", content, { mode: 0o600 });
      await rename(options.dataFile + ".tmp", options.dataFile);
    });
    // 一次写失败只影响这一次，后面的写入不能跟着失败。
    writes = write.catch(() => log("PERSIST_FAILED"));
    return write;
  };
  const peers = new Set<Peer>();
  const hosts = new Map<string, Peer>();
  const failures = new Map<string, { count: number; until: number }>();
  const log = options.log ?? (() => {});
  function send(ws: WebSocket, frame: object) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(frame);
    if (ws.bufferedAmount + Buffer.byteLength(data) > 16 * 1024 * 1024) {
      ws.close(1013);
      return;
    }
    ws.send(data);
  }
  function remove(room: string, hash: string) {
    if (grants.get(hash)?.room === room) grants.delete(hash);
    for (const p of peers)
      if (!p.host && p.room === room && p.hash === hash) p.ws.close(4410);
  }
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(req.url === "/healthz" && req.method === "GET" ? 200 : 404);
    res.end(
      JSON.stringify(
        req.url === "/healthz" ? { ok: true, v: 1 } : { error: "NOT_FOUND" },
      ),
    );
  });
  // 2 MiB 到 4 MiB 之间回错误并保留连接；再大的帧由 ws 直接断开，不进内存。
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: HARD_MAX,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws, req) => {
    // 反向代理后面所有连接的地址都是代理，不分开的话一个人失败就会把所有人挡在外面。
    const forwarded = options.trustProxy
      ? String(req.headers["x-forwarded-for"] ?? "").split(",").at(-1)?.trim()
      : "";
    const ip = forwarded || req.socket.remoteAddress || "";
    if (
      wss.clients.size > 256 ||
      ((failures.get(ip)?.until ?? 0) > Date.now() &&
        failures.get(ip)!.count >= 10)
    ) {
      ws.close(4429);
      return;
    }
    let peer: Peer | undefined;
    const timer = setTimeout(() => fail(), options.helloMs ?? 10_000);
    function fail() {
      const entry = failures.get(ip);
      const f =
        entry && entry.until > Date.now()
          ? entry
          : { count: 0, until: Date.now() + 60_000 };
      f.count++;
      failures.set(ip, f);
      ws.close(f.count >= 10 ? 4429 : 4401);
    }
    let queue = Promise.resolve();
    ws.on("message", (raw, binary) => {
      queue = queue
        .then(async () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (
            (Array.isArray(raw)
              ? raw.reduce((n, b) => n + b.length, 0)
              : raw instanceof ArrayBuffer
                ? raw.byteLength
                : raw.length) > MAX
          ) {
            send(ws, { t: "error", code: "PAYLOAD_TOO_LARGE" });
            return;
          }
          if (binary) {
            ws.close(4400);
            return;
          }
          if (!peer && raw.toString().length > MAX_HELLO_BYTES) {
            fail();
            return;
          }
          let f;
          try {
            f = JSON.parse(raw.toString());
          } catch {
            ws.close(4400);
            return;
          }
          if (!f || typeof f !== "object") {
            ws.close(4400);
            return;
          }
          if (!peer) {
            if (f.v !== 1) {
              ws.close(4400);
              return;
            }
            if (!b64(f.room, 16) || typeof f.token !== "string") {
              fail();
              return;
            }
            const host = f.t === "host-hello";
            let hash = "";
            if (host) {
              if (
                !timingSafeEqual(digest(f.token), digest(options.hostToken))
              ) {
                fail();
                return;
              }
            } else {
              if (f.t !== "client-hello" || !b64(f.token, 32)) {
                fail();
                return;
              }
              hash = tokenHash(f.token);
              const grant = grants.get(hash);
              if (
                !grant ||
                grant.room !== f.room ||
                (grant.expiresAt !== null && grant.expiresAt <= Date.now())
              ) {
                fail();
                return;
              }
              if (
                [...peers].filter((p) => !p.host && p.room === f.room).length >=
                8
              ) {
                ws.close(4429);
                return;
              }
              if (grant.oneTime) grants.delete(hash);
            }
            clearTimeout(timer);
            peer = {
              ws,
              id: randomUUID(),
              room: f.room,
              host,
              hash,
              lastPong: Date.now(),
            };
            peers.add(peer);
            if (host) {
              hosts.get(f.room)?.ws.close(4409);
              hosts.set(f.room, peer);
              for (const p of peers)
                if (!p.host && p.room === f.room)
                  send(p.ws, { t: "host", online: true });
            }
            send(ws, {
              t: "hello-ack",
              conn: peer.id,
              hostOnline: hosts.has(f.room),
            });
            if (!host) {
              const activeHost = hosts.get(f.room);
              if (activeHost)
                send(activeHost.ws, { t: "peer", conn: peer.id, online: true });
            }
            log("connected");
            return;
          }
          const p = peer;
          if (p.host && hosts.get(p.room) !== p) return;
          if (p.host && f.t === "allow") {
            if (
              !hashValid(f.tokenHash) ||
              typeof f.oneTime !== "boolean" ||
              (f.oneTime
                ? !Number.isFinite(f.expiresAt) ||
                  f.expiresAt <= Date.now() ||
                  f.expiresAt > Date.now() + 300_000
                : f.expiresAt !== null)
            ) {
              ws.close(4400);
              return;
            }
            const existing = grants.get(f.tokenHash);
            if (existing && existing.room !== p.room) {
              ws.close(4401);
              return;
            }
            grants.set(f.tokenHash, {
              room: p.room,
              oneTime: f.oneTime,
              expiresAt: f.expiresAt,
            });
            if (!f.oneTime) await persist();
            return;
          }
          if (p.host && f.t === "revoke" && hashValid(f.tokenHash)) {
            remove(p.room, f.tokenHash);
            await persist();
            return;
          }
          if (
            p.host &&
            f.t === "allow-sync" &&
            Array.isArray(f.tokenHashes) &&
            f.tokenHashes.every(hashValid)
          ) {
            const keep = new Set(f.tokenHashes);
            for (const [hash, g] of grants)
              if (g.room === p.room && !g.oneTime && !keep.has(hash))
                remove(p.room, hash);
            await persist();
            return;
          }
          if (
            f.t === "data" &&
            typeof f.d === "string" &&
            /^[A-Za-z0-9_-]*$/.test(f.d)
          ) {
            if (p.host) {
              const to = [...peers].find(
                (c) => c.room === p.room && !c.host && c.id === f.to,
              );
              if (to) send(to.ws, { t: "data", d: f.d });
            } else {
              const host = hosts.get(p.room);
              if (host) send(host.ws, { t: "data", from: p.id, d: f.d });
              else send(ws, { t: "error", code: "HOST_OFFLINE" });
            }
            return;
          }
          ws.close(4400);
        })
        .catch(() => {
          log("INTERNAL");
          ws.close(1011);
        });
    });
    ws.on("pong", () => {
      if (peer) peer.lastPong = Date.now();
    });
    ws.on("error", () => log("SOCKET_ERROR"));
    ws.on("close", () => {
      clearTimeout(timer);
      if (!peer) return;
      peers.delete(peer);
      log("disconnected");
      if (peer.host && hosts.get(peer.room) === peer) {
        hosts.delete(peer.room);
        for (const p of peers)
          if (!p.host && p.room === peer.room)
            send(p.ws, { t: "host", online: false });
      } else if (!peer.host) {
        const host = hosts.get(peer.room);
        if (host) send(host.ws, { t: "peer", conn: peer.id, online: false });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const [ip, f] of failures)
      if (f.until <= Date.now()) failures.delete(ip);
    for (const [hash, g] of grants)
      if (g.expiresAt !== null && g.expiresAt <= Date.now())
        grants.delete(hash);
    for (const p of peers) {
      if (Date.now() - p.lastPong >= 90_000) p.ws.terminate();
      else p.ws.ping();
    }
  }, 30_000);
  return {
    server,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      await writes;
    },
  };
}
