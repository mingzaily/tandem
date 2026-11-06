import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../src/lib/client.ts';
import type { Identity } from '../src/lib/pairing.ts';
import { Pairing, type PairCode } from '../src/lib/pairing.ts';

test('reconnecting ignores errors from the socket being replaced', () => {
  const sockets: WebSocket[] = [];
  const client = new Client(() => {
    const socket = { close() {}, send() {} } as unknown as WebSocket;
    sockets.push(socket);
    return socket;
  });
  const errors: Error[] = [];
  client.onError = (error) => errors.push(error);
  const identity = { relay: 'ws://localhost/ws' } as Identity;
  client.connect(identity);
  client.connect(identity);
  sockets[0].onerror?.call(sockets[0], {} as Event);
  assert.equal(errors.length, 0);
  sockets[1].onerror?.call(sockets[1], {} as Event);
  assert.equal(errors.length, 1);
  client.close();
});

for (const code of [4411, 4429]) {
  test(`session close ${code} reconnects with capped exponential backoff`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sockets: WebSocket[] = [];
    const client = new Client(() => {
      const socket = { close() {}, send() {} } as unknown as WebSocket;
      sockets.push(socket);
      return socket;
    });
    t.after(() => client.close());
    const statuses: string[] = [];
    const errors: Error[] = [];
    client.onStatus = (status) => statuses.push(status);
    client.onError = (error) => errors.push(error);
    client.connect({ relay: 'ws://localhost/ws' } as Identity);

    for (const delay of [1500, 3000, 6000, 12000, 24000, 30000, 30000]) {
      const current = sockets.at(-1)!;
      current.onclose!.call(current, { code } as CloseEvent);
      assert.equal(statuses.at(-1), 'offline');
      const attempts = sockets.length;
      t.mock.timers.tick(delay - 1);
      assert.equal(sockets.length, attempts, 'wait for the scheduled retry');
      t.mock.timers.tick(1);
      assert.equal(sockets.length, attempts + 1);
      assert.equal(statuses.at(-1), 'connecting');
    }
    assert.deepEqual(errors, []);
    const current = sockets.at(-1)!;
    current.onclose!.call(current, { code } as CloseEvent);
    client.close();
    const attempts = sockets.length;
    t.mock.timers.tick(60000);
    assert.equal(sockets.length, attempts, 'manual close cancels the retry');
  });
}

for (const code of [4400, 4401, 4410]) {
  test(`session close ${code} remains terminal`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sockets: WebSocket[] = [];
    const client = new Client(() => {
      const socket = { close() {}, send() {} } as unknown as WebSocket;
      sockets.push(socket);
      return socket;
    });
    t.after(() => client.close());
    const statuses: string[] = [];
    client.onStatus = (status) => statuses.push(status);
    client.connect({ relay: 'ws://localhost/ws' } as Identity);
    sockets[0].onclose!.call(sockets[0], { code } as CloseEvent);
    assert.equal(statuses.at(-1), code === 4410 ? 'revoked' : 'closed');
    t.mock.timers.tick(60000);
    assert.equal(sockets.length, 1);
  });
}

for (const code of [4411, 4429]) {
  test(`pairing close ${code} fails this attempt without reusing the one-time token`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(Pairing, 'create', async () => ({}) as Pairing);
    const sockets: WebSocket[] = [];
    const client = new Client(() => {
      const socket = { close() {}, send() {} } as unknown as WebSocket;
      sockets.push(socket);
      return socket;
    });
    t.after(() => client.close());
    const paired = client.pair({ relay: 'ws://localhost/ws' } as PairCode, 'phone');
    const rejected = assert.rejects(paired, new RegExp(String(code)));
    await new Promise<void>((resolve) => setImmediate(resolve));
    sockets[0].onclose!.call(sockets[0], { code } as CloseEvent);
    await rejected;
    t.mock.timers.tick(60000);
    assert.equal(sockets.length, 1);
  });
}

for (const code of [4410, 4411]) {
  test(`a final pairing frame finishes decryption before close ${code} is handled`, async (t) => {
    let finish!: (identity: Identity) => void;
    let entered!: () => void;
    const finishing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    t.mock.method(
      Pairing,
      'create',
      async () =>
        ({
          first: async () => ({}),
          second: async () => ({ code: '123456', frame: {} }),
          finish: () => {
            entered();
            return new Promise<Identity>((resolve) => {
              finish = resolve;
            });
          },
        }) as unknown as Pairing,
    );
    const socket = { readyState: 1, send() {}, close() {} } as unknown as WebSocket;
    const client = new Client(() => socket);
    const paired = Promise.allSettled([client.pair({ relay: 'ws://localhost/ws' } as PairCode, 'phone')]);
    await new Promise<void>((r) => setImmediate(r));
    socket.onmessage?.call(socket, {
      data: JSON.stringify({
        t: 'data',
        d: Buffer.from(JSON.stringify({ k: 'pair2', e: '', mac: '' })).toString('base64url'),
      }),
    } as MessageEvent);
    await new Promise<void>((r) => setImmediate(r));
    socket.onmessage?.call(socket, {
      data: JSON.stringify({
        t: 'data',
        d: Buffer.from(JSON.stringify({ k: 'pair4', c: '' })).toString('base64url'),
      }),
    } as MessageEvent);
    await finishing;
    socket.onclose?.call(socket, { code } as CloseEvent);
    const identity = { clientId: 'phone' } as Identity;
    finish(identity);
    assert.deepEqual(await paired, [{ status: 'fulfilled', value: identity }]);
    client.close();
  });
}
