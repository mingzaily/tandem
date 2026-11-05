export const utf8 = (s: string) => new TextEncoder().encode(s);
export const text = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(b);
export function cat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
export function b64(b: Uint8Array) {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function unb64(s: string) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('base64url 格式错误');
  const b = Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
  if (b64(b) !== s) throw new Error('base64url 编码错误');
  return b;
}
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;
const subtle = crypto.subtle;
export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const sha = async (b: Uint8Array) => new Uint8Array(await subtle.digest('SHA-256', buf(b)));
export const generate = (kind: 'ECDH' | 'ECDSA', extractable = false) =>
  subtle.generateKey(
    { name: kind, namedCurve: 'P-256' },
    extractable,
    kind === 'ECDH' ? ['deriveBits'] : ['sign', 'verify'],
  );
export const pub = async (key: CryptoKeyPair) => new Uint8Array(await subtle.exportKey('raw', key.publicKey));
export const publicKey = (b: Uint8Array, kind: 'ECDH' | 'ECDSA') =>
  subtle.importKey(
    'raw',
    buf(b),
    { name: kind, namedCurve: 'P-256' },
    true,
    kind === 'ECDH' ? [] : ['verify'],
  );
export const sign = async (key: CryptoKey, b: Uint8Array) =>
  b64(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, buf(b))));
export async function verify(key: Uint8Array, signature: string, b: Uint8Array) {
  if (
    !(await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await publicKey(key, 'ECDSA'),
      buf(unb64(signature)),
      buf(b),
    ))
  )
    throw new Error('签名校验失败');
}
export async function derive(
  key: CryptoKey,
  remote: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bytes: number,
) {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: await publicKey(remote, 'ECDH') }, key, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
      ikm,
      bytes * 8,
    ),
  );
}
export async function mac(key: Uint8Array, data: Uint8Array) {
  return b64(
    new Uint8Array(
      await subtle.sign(
        'HMAC',
        await subtle.importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        buf(data),
      ),
    ),
  );
}
export async function checkMac(key: Uint8Array, value: string, data: Uint8Array) {
  if (
    !(await subtle.verify(
      'HMAC',
      await subtle.importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
      buf(unb64(value)),
      buf(data),
    ))
  )
    throw new Error('配对验证码校验失败');
}
export async function aes(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: string,
  data: Uint8Array,
  encrypt: boolean,
) {
  const k = await subtle.importKey('raw', buf(key), 'AES-GCM', false, [encrypt ? 'encrypt' : 'decrypt']);
  return new Uint8Array(
    await subtle[encrypt ? 'encrypt' : 'decrypt'](
      { name: 'AES-GCM', iv: buf(nonce), additionalData: buf(utf8(aad)), tagLength: 128 },
      k,
      buf(data),
    ),
  );
}
export async function pairKeys(
  ec: Uint8Array,
  sc: Uint8Array,
  eh: Uint8Array,
  sh: Uint8Array,
  privateKey: CryptoKey,
  remote: Uint8Array,
  secret: Uint8Array,
) {
  const th = await sha(cat(utf8('tandem-pair-v1'), ec, sc, eh, sh));
  const okm = await derive(privateKey, remote, secret, cat(utf8('tandem-pair-v1'), th), 96);
  return {
    th,
    okm,
    macH: await mac(okm.slice(0, 32), cat(utf8('host'), th)),
    macC: await mac(okm.slice(32, 64), cat(utf8('client'), th)),
    code: (new DataView(th.buffer).getUint32(0) % 1_000_000).toString().padStart(6, '0'),
  };
}
export async function sessionKeys(
  id: Uint8Array,
  ec: Uint8Array,
  eh: Uint8Array,
  sc: Uint8Array,
  sh: Uint8Array,
  privateKey: CryptoKey,
  remote: Uint8Array,
) {
  const th = await sha(cat(utf8('tandem-session-v1'), id, ec, eh, sc, sh));
  return { th, okm: await derive(privateKey, remote, th, utf8('tandem-session-v1'), 64) };
}
export interface CipherFrame {
  k: 'm';
  n: number;
  c: string;
}
const CHUNK = 512 * 1024,
  LIMIT = 32 * 1024 * 1024;
export class Cipher {
  private outgoing = 0;
  private incoming = 0;
  private parts: Uint8Array[] = [];
  private size = 0;
  private broken = false;
  constructor(
    private sendKey: Uint8Array,
    private receiveKey: Uint8Array,
  ) {}
  private nonce(n: number) {
    const out = new Uint8Array(12);
    new DataView(out.buffer).setBigUint64(4, BigInt(n));
    return out;
  }
  async encode(value: unknown): Promise<CipherFrame[]> {
    if (this.broken) throw new Error('加密通道已关闭');
    const bytes = utf8(JSON.stringify(value));
    if (bytes.length > LIMIT) throw new Error('消息超过 32 MiB');
    const frames: CipherFrame[] = [];
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const n = this.outgoing++;
      const last = at + CHUNK >= bytes.length;
      frames.push({
        k: 'm',
        n,
        c: b64(
          await aes(
            this.sendKey,
            this.nonce(n),
            'tandem-m-v1',
            cat(new Uint8Array([last ? 0 : 1]), bytes.slice(at, at + CHUNK)),
            true,
          ),
        ),
      });
    }
    return frames;
  }
  async decode(frame: CipherFrame): Promise<unknown | undefined> {
    try {
      if (this.broken || frame.k !== 'm' || !Number.isSafeInteger(frame.n) || frame.n !== this.incoming)
        throw new Error('消息序号错误');
      const bytes = await aes(this.receiveKey, this.nonce(frame.n), 'tandem-m-v1', unb64(frame.c), false);
      if (bytes.length < 1 || bytes.length > CHUNK + 1 || bytes[0] > 1) throw new Error('消息分片格式错误');
      this.incoming++;
      this.size += bytes.length - 1;
      if (this.size > LIMIT) throw new Error('消息超过 32 MiB');
      this.parts.push(bytes.slice(1));
      if (bytes[0] === 1) return;
      const value: unknown = JSON.parse(text(cat(...this.parts)));
      this.parts = [];
      this.size = 0;
      return value;
    } catch (e) {
      this.broken = true;
      this.parts = [];
      throw e;
    }
  }
}
