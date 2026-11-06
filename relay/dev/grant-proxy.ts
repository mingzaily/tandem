// Delay registration acknowledgements while exercising the real desktop.
import assert from "node:assert/strict";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { WebSocket, WebSocketServer } from "ws";

export async function grantProxy(target: () => string, pairFile: string) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const errors: unknown[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const upstreams = new Set<WebSocket>();
  let pairingGrants = 0,
    permanentGrants = 0,
    syncs = 0,
    disconnects = 0;
  server.on("connection", (downstream) => {
    const upstream = new WebSocket(target());
    upstreams.add(upstream);
    const pending = new Map<string, boolean>();
    let opened = false;
    const queued: string[] = [];
    const check = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        errors.push(error);
      }
    };
    upstream.on("open", () => {
      opened = true;
      for (const raw of queued) upstream.send(raw);
    });
    downstream.on("message", (raw) => {
      const message = raw.toString(),
        frame = JSON.parse(message);
      check(() => {
        if (frame.t === "allow") {
          assert.equal(typeof frame.id, "string", "桌面端登记请求携带确认 ID");
          pending.set(frame.id, frame.oneTime);
          if (frame.oneTime) {
            assert.equal(frame.ttlMs, 300_000);
            assert.equal(frame.expiresAt, undefined);
            pairingGrants++;
          } else permanentGrants++;
        }
        if (frame.t === "allow-sync") {
          assert.equal(pending.size, 0, "全部长期登记确认后同步清单");
          syncs++;
        }
        if (frame.t === "disconnect") disconnects++;
        if (frame.t === "data" && frame.to) {
          const data = JSON.parse(Buffer.from(frame.d, "base64url").toString());
          if (data.k === "pair4")
            assert.equal(pending.size, 0, "长期登记确认后交付 pair4");
        }
      });
      if (opened && upstream.readyState === WebSocket.OPEN)
        upstream.send(message);
      else queued.push(message);
    });
    upstream.on("message", (raw) => {
      const message = raw.toString(),
        frame = JSON.parse(message);
      if (frame.t !== "allow-ack") {
        if (downstream.readyState === WebSocket.OPEN) downstream.send(message);
        return;
      }
      const oneTime = pending.get(frame.id);
      // The first attempt exercises the desktop's bounded acknowledgement wait.
      if (oneTime && pairingGrants === 1) return;
      const timer = setTimeout(async () => {
        timers.delete(timer);
        if (oneTime) {
          try {
            await access(pairFile);
            errors.push(new Error("准入确认前已写出配对码"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              errors.push(error);
          }
        }
        pending.delete(frame.id);
        if (downstream.readyState === WebSocket.OPEN) downstream.send(message);
      }, 600);
      timers.add(timer);
    });
    upstream.on("close", (code) => {
      upstreams.delete(upstream);
      downstream.close(code === 1006 ? 1011 : code);
    });
    downstream.on("close", () => {
      if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      else upstream.close();
    });
    upstream.on("error", () => downstream.close(1011));
    downstream.on("error", () => upstream.close());
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`,
    counts: () => ({ pairingGrants, permanentGrants, syncs, disconnects }),
    verify: () => assert.deepEqual(errors, []),
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of upstreams) socket.terminate();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
