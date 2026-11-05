import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  aes,
  b64,
  cat,
  Cipher,
  pairKeys,
  sessionKeys,
  unb64,
  utf8,
  verify,
  checkMac,
} from '../src/lib/crypto.ts';
import { Pairing, parsePairCode } from '../src/lib/pairing.ts';
const v = JSON.parse(await readFile(new URL('../../docs/relay-test-vectors.json', import.meta.url), 'utf8'));
const key = await crypto.subtle.importKey(
  'jwk',
  v.privateKeys.ec,
  { name: 'ECDH', namedCurve: 'P-256' },
  false,
  ['deriveBits'],
);
const args = ['ec', 'sc', 'eh', 'sh'].map((k) => unb64(v.publicKeys[k]));
test('固定配对向量、签名、公钥与 pair4 密文', async () => {
  const p = await pairKeys(args[0], args[1], args[2], args[3], key, args[2], unb64(v.secret));
  for (const k of ['th', 'okm'] as const) assert.equal(b64(p[k]), v.pair[k]);
  for (const k of ['macH', 'macC', 'code'] as const) assert.equal(p[k], v.pair[k]);
  await verify(args[1], v.pair.signature, p.th);
  assert.equal(
    b64(await aes(p.okm.slice(64), unb64(v.pair.nonce), v.pair.aad, utf8(v.pair.plaintext), true)),
    v.pair.ciphertext,
  );
  assert.deepEqual(
    await aes(p.okm.slice(64), unb64(v.pair.nonce), v.pair.aad, unb64(v.pair.ciphertext), false),
    utf8(v.pair.plaintext),
  );
});
test('固定重连握手向量和消息密文', async () => {
  const s = await sessionKeys(unb64(v.clientId), args[0], args[2], args[1], args[3], key, args[2]);
  assert.equal(b64(s.th), v.session.th);
  assert.equal(b64(s.okm), v.session.okm);
  await verify(args[3], v.session.hostSignature, cat(utf8('host'), s.th));
  await verify(args[1], v.session.clientSignature, cat(utf8('client'), s.th));
  const frames = await new Cipher(s.okm.slice(0, 32), s.okm.slice(32)).encode(
    JSON.parse(v.session.plaintext),
  );
  assert.equal(frames[0].c, v.session.ciphertext);
  assert.deepEqual(
    await new Cipher(s.okm.slice(32), s.okm.slice(0, 32)).decode(frames[0]),
    JSON.parse(v.session.plaintext),
  );
});
test('错误 macH 和签名被拒绝', async () => {
  await assert.rejects(
    checkMac(unb64(v.pair.okm).slice(0, 32), b64(new Uint8Array(32)), cat(utf8('host'), unb64(v.pair.th))),
  );
  await assert.rejects(verify(args[3], v.session.clientSignature, cat(utf8('host'), unb64(v.session.th))));
  const pair = await Pairing.create({
    v: 1,
    relay: 'ws://localhost/ws',
    room: b64(new Uint8Array(16)),
    host: v.publicKeys.sh,
    token: v.token,
    secret: v.secret,
  });
  assert.equal(pair.signing.privateKey.extractable, false);
  await assert.rejects(pair.second(v.publicKeys.eh, b64(new Uint8Array(32))));
});
test('乱序、重放及被改动的密文关闭加密通道', async () => {
  const k = unb64(v.session.okm);
  const frame = { k: 'm' as const, n: 0, c: v.session.ciphertext };
  const receiver = () => new Cipher(k.slice(32), k.slice(0, 32));
  await assert.rejects(receiver().decode({ ...frame, n: 1 }));
  const c = receiver();
  await c.decode(frame);
  await assert.rejects(c.decode(frame));
  const bytes = unb64(frame.c);
  bytes[0] ^= 1;
  const broken = receiver();
  await assert.rejects(broken.decode({ ...frame, c: b64(bytes) }));
  await assert.rejects(broken.decode(frame));
});
test('512 KiB 分片可重组跨 UTF-8 字符', async () => {
  const k = unb64(v.session.okm);
  const value = { text: '手机'.repeat(200_000) };
  const frames = await new Cipher(k.slice(0, 32), k.slice(32)).encode(value);
  assert.ok(frames.length > 1);
  const c = new Cipher(k.slice(32), k.slice(0, 32));
  for (const frame of frames.slice(0, -1)) assert.equal(await c.decode(frame), undefined);
  assert.deepEqual(await c.decode(frames.at(-1)!), value);
});
test('配对码限制安全地址和字段长度', () => {
  const value = {
    v: 1,
    relay: 'ws://example.com/ws',
    room: v.clientId,
    host: v.publicKeys.sh,
    token: v.token,
    secret: v.secret,
  };
  assert.throws(() => parsePairCode('tandem-pair:' + b64(utf8(JSON.stringify(value)))));
  value.relay = 'wss://relay.example/ws';
  assert.equal(parsePairCode('tandem-pair:' + b64(utf8(JSON.stringify(value)))).relay, value.relay);
});
test('node:crypto 独立验证 ECDH 和 HKDF 固定向量', async () => {
  const { createPrivateKey, createPublicKey, diffieHellman, hkdfSync, createHash, createHmac } =
    await import('node:crypto');
  const shared = diffieHellman({
    privateKey: createPrivateKey({ key: v.privateKeys.ec, format: 'jwk' }),
    publicKey: createPublicKey(createPrivateKey({ key: v.privateKeys.eh, format: 'jwk' })),
  });
  const th = createHash('sha256')
    .update(cat(utf8('tandem-pair-v1'), ...args))
    .digest();
  assert.equal(b64(th), v.pair.th);
  const okm = new Uint8Array(
    hkdfSync('sha256', shared, unb64(v.secret), cat(utf8('tandem-pair-v1'), th), 96),
  );
  assert.equal(b64(okm), v.pair.okm);
  assert.equal(
    b64(
      createHmac('sha256', okm.slice(0, 32))
        .update(cat(utf8('host'), th))
        .digest(),
    ),
    v.pair.macH,
  );
});
test('第二帧使用八字节大端 nonce，双向密钥分开', async () => {
  const k = unb64(v.session.okm),
    sender = new Cipher(k.slice(0, 32), k.slice(32));
  await sender.encode({ first: true });
  const [frame] = await sender.encode({ second: true });
  assert.equal(frame.n, 1);
  const nonce = new Uint8Array(12);
  nonce[11] = 1;
  assert.equal(
    frame.c,
    b64(
      await aes(
        k.slice(0, 32),
        nonce,
        'tandem-m-v1',
        cat(new Uint8Array([0]), utf8(JSON.stringify({ second: true }))),
        true,
      ),
    ),
  );
  await assert.rejects(aes(k.slice(32), nonce, 'tandem-m-v1', unb64(frame.c), false));
});
