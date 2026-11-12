import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../src/lib/client.ts';
import {
  b64,
  cat,
  Cipher,
  generate,
  pub,
  random,
  sessionKeys,
  sign,
  text,
  unb64,
  utf8,
} from '../src/lib/crypto.ts';
import type { Identity } from '../src/lib/pairing.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function session() {
  const host = await generate('ECDSA');
  const identity: Identity = {
    relay: 'ws://localhost/ws',
    room: b64(random(16)),
    token: b64(random(32)),
    clientId: b64(random(16)),
    host: b64(await pub(host)),
    signing: await generate('ECDSA'),
  };
  const hello = deferred<{ e: string }>();
  const ready = deferred<void>();
  const socket = {
    readyState: 1,
    close() {},
    send(raw: string) {
      const outer = JSON.parse(raw);
      if (outer.t !== 'data') return;
      const frame = JSON.parse(text(unb64(outer.d)));
      if (frame.k === 'hello1') hello.resolve(frame);
    },
  } as unknown as WebSocket;
  let connected = false;
  const client = new Client(() => {
    if (connected) return { ...socket } as WebSocket;
    connected = true;
    return socket;
  });
  const statuses: string[] = [];
  client.onStatus = (status) => {
    statuses.push(status);
    if (status === 'ready') ready.resolve();
  };
  client.connect(identity);
  const deliver = (frame: object) =>
    socket.onmessage!.call(socket, {
      data: JSON.stringify({ t: 'data', d: b64(utf8(JSON.stringify(frame))) }),
    } as MessageEvent);
  socket.onmessage!.call(socket, {
    data: JSON.stringify({ t: 'hello-ack', hostOnline: true }),
  } as MessageEvent);
  const first = await hello.promise;
  const ephemeral = await generate('ECDH');
  const eh = await pub(ephemeral);
  const keys = await sessionKeys(
    unb64(identity.clientId),
    unb64(first.e),
    eh,
    await pub(identity.signing),
    await pub(host),
    ephemeral.privateKey,
    unb64(first.e),
  );
  deliver({ k: 'hello2', e: b64(eh), sig: await sign(host.privateKey, cat(utf8('host'), keys.th)) });
  await ready.promise;
  const cipher = new Cipher(keys.okm.slice(32), keys.okm.slice(0, 32));
  return { client, socket, statuses, deliver, cipher, identity };
}

for (const code of [4410, 4411]) {
  test(`a received reply finishes asynchronous decryption before session close ${code} rejects requests`, async (t) => {
    const { client, socket, statuses, deliver, cipher } = await session();
    t.after(() => client.close());
    const entered = deferred<void>();
    const release = deferred<void>();
    const decode = Cipher.prototype.decode;
    t.mock.method(
      Cipher.prototype,
      'decode',
      async function (this: Cipher, ...args: Parameters<Cipher['decode']>) {
        entered.resolve();
        await release.promise;
        return decode.apply(this, args);
      },
    );
    const response = client.request<{ ok: boolean }>('live.snapshot');
    for (const frame of await cipher.encode({ id: 1, ok: true, r: { ok: true } })) deliver(frame);
    await entered.promise;
    socket.onclose!.call(socket, { code } as CloseEvent);
    assert.equal(statuses.at(-1), 'ready');
    release.resolve();
    assert.deepEqual(await response, { ok: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(statuses.at(-1), code === 4410 ? 'revoked' : 'offline');
  });
}

test('a replaced connection cannot publish an event whose decryption completes late', async (t) => {
  const { client, deliver, cipher, identity } = await session();
  t.after(() => client.close());
  const entered = deferred<void>();
  const release = deferred<void>();
  const decode = Cipher.prototype.decode;
  t.mock.method(
    Cipher.prototype,
    'decode',
    async function (this: Cipher, ...args: Parameters<Cipher['decode']>) {
      entered.resolve();
      await release.promise;
      return decode.apply(this, args);
    },
  );
  const received: unknown[] = [];
  client.onEvent = (event) => received.push(event);
  for (const frame of await cipher.encode({ ev: 'turn.event', p: { seq: 90 } })) deliver(frame);
  await entered.promise;
  client.connect(identity);
  release.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(received, []);
});
