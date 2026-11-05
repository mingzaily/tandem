import { aes, b64, cat, checkMac, generate, pairKeys, pub, sign, text, unb64, utf8 } from './crypto';
export interface PairCode {
  v: 1;
  relay: string;
  room: string;
  host: string;
  token: string;
  secret: string;
}
export interface Identity {
  relay: string;
  room: string;
  host: string;
  clientId: string;
  token: string;
  signing: CryptoKeyPair;
}
export function parsePairCode(raw: string): PairCode {
  if (!raw.trim().startsWith('tandem-pair:')) throw new Error('请粘贴完整的 Tandem 配对码');
  const p = JSON.parse(text(unb64(raw.trim().slice(12)))) as PairCode;
  const url = new URL(p.relay);
  if (
    p.v !== 1 ||
    (url.protocol !== 'wss:' &&
      !(url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password
  )
    throw new Error('中转地址或协议版本错误');
  for (const [value, length] of [
    [p.room, 16],
    [p.host, 65],
    [p.token, 32],
    [p.secret, 32],
  ] as const)
    if (unb64(value).length !== length) throw new Error('配对码字段长度错误');
  return p;
}
export class Pairing {
  private constructor(
    readonly code: PairCode,
    readonly signing: CryptoKeyPair,
    readonly ephemeral: CryptoKeyPair,
  ) {}
  private keys?: Awaited<ReturnType<typeof pairKeys>>;
  static async create(code: PairCode) {
    return new Pairing(code, await generate('ECDSA'), await generate('ECDH'));
  }
  async first(name: string) {
    return { k: 'pair1', e: b64(await pub(this.ephemeral)), s: b64(await pub(this.signing)), name };
  }
  async second(e: string, macH: string) {
    const k = await pairKeys(
      await pub(this.ephemeral),
      await pub(this.signing),
      unb64(e),
      unb64(this.code.host),
      this.ephemeral.privateKey,
      unb64(e),
      unb64(this.code.secret),
    );
    await checkMac(k.okm.slice(0, 32), macH, cat(utf8('host'), k.th));
    this.keys = k;
    return {
      code: k.code,
      frame: { k: 'pair3', mac: k.macC, sig: await sign(this.signing.privateKey, k.th) },
    };
  }
  async finish(c: string): Promise<Identity> {
    if (!this.keys) throw new Error('配对顺序错误');
    const value = JSON.parse(
      text(await aes(this.keys.okm.slice(64), new Uint8Array(12), 'tandem-pair4', unb64(c), false)),
    );
    if (unb64(value.clientId).length !== 16 || unb64(value.token).length !== 32)
      throw new Error('设备凭证格式错误');
    return {
      relay: this.code.relay,
      room: this.code.room,
      host: this.code.host,
      clientId: value.clientId,
      token: value.token,
      signing: this.signing,
    };
  }
}
