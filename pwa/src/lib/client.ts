import { b64, cat, Cipher, generate, pub, sessionKeys, sign, text, unb64, utf8, verify } from './crypto';
import { Pairing, type Identity, type PairCode } from './pairing';
export type Status = 'connecting' | 'offline' | 'ready' | 'revoked' | 'pairing' | 'closed';
type Frame = Record<string, any>;
const FIRST_RETRY_MS = 1500;
const MAX_RETRY_MS = 30_000;
export class Client {
  onStatus: (status: Status) => void = () => {};
  onEvent: (event: Frame) => void = () => {};
  onCode: (code: string) => void = () => {};
  onError: (error: Error) => void = () => {};
  private ws?: WebSocket;
  private cipher?: Cipher;
  private retry?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      onResult?: (v: any) => void;
    }
  >();
  private outgoing = Promise.resolve();
  constructor(private socket: (url: string) => WebSocket = (url) => new WebSocket(url)) {}
  private data(frame: unknown) {
    this.ws!.send(JSON.stringify({ t: 'data', d: b64(utf8(JSON.stringify(frame))) }));
  }
  private clear() {
    this.cipher = undefined;
    clearTimeout(this.handshakeTimer);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('连接已断开，本次操作结果未知'));
    }
    this.pending.clear();
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.clear();
    this.ws?.close();
    this.onStatus('closed');
  }
  async pair(code: PairCode, name: string): Promise<Identity> {
    this.close();
    this.stopped = false;
    this.onStatus('pairing');
    const pairing = await Pairing.create(code);
    let phase = 0;
    return new Promise((resolve, reject) => {
      const ws = (this.ws = this.socket(code.relay));
      const timeout = setTimeout(() => {
        reject(new Error('配对已超时'));
        ws.close();
      }, 300_000);
      ws.onopen = () =>
        ws.send(JSON.stringify({ t: 'client-hello', v: 1, room: code.room, token: code.token }));
      let queue = Promise.resolve();
      let done = false;
      ws.onmessage = (event) => {
        queue = queue
          .then(async () => {
            const f = JSON.parse(String(event.data));
            if (f.t === 'hello-ack') {
              if (!f.hostOnline) throw new Error('桌面端已离线，请重新生成配对码');
              this.data(await pairing.first(name));
              return;
            }
            if (f.t !== 'data') return;
            const m = JSON.parse(text(unb64(f.d)));
            if (m.k === 'pair-denied') throw new Error('桌面端已拒绝配对');
            if (m.k === 'pair2' && phase === 0) {
              phase = 1;
              const second = await pairing.second(m.e, m.mac);
              this.onCode(second.code);
              this.data(second.frame);
              return;
            }
            if (m.k === 'pair4' && phase === 1) {
              const identity = await pairing.finish(m.c);
              done = true;
              clearTimeout(timeout);
              ws.close();
              resolve(identity);
              return;
            }
            throw new Error('配对消息顺序错误');
          })
          .catch((e) => {
            if (ws.readyState === 1) this.data({ k: 'pair-denied' });
            clearTimeout(timeout);
            reject(e);
            ws.close();
          });
      };
      const end = (message: string) => {
        clearTimeout(timeout);
        // WebCrypto may still be decrypting the final frame when the transport closes.
        void queue.then(() => {
          if (!done) reject(new Error(message));
        });
      };
      ws.onerror = () => end('连接中转失败');
      ws.onclose = (event) => {
        end(`配对连接已关闭（${event.code}），配对码可能已过期或使用`);
      };
    });
  }
  connect(identity: Identity) {
    this.close();
    this.stopped = false;
    let delay = FIRST_RETRY_MS;
    const open = () => {
      if (this.stopped) return;
      this.onStatus('connecting');
      this.clear();
      const ws = (this.ws = this.socket(identity.relay));
      let phase = 0;
      let ephemeral: CryptoKeyPair;
      let keys: Awaited<ReturnType<typeof sessionKeys>>;
      let queue = Promise.resolve();
      const start = async () => {
        this.clear();
        phase = 1;
        ephemeral = await generate('ECDH');
        this.data({ k: 'hello1', v: 1, clientId: identity.clientId, e: b64(await pub(ephemeral)) });
        this.handshakeTimer = setTimeout(() => ws.close(), 10_000);
      };
      ws.onopen = () =>
        ws.send(JSON.stringify({ t: 'client-hello', v: 1, room: identity.room, token: identity.token }));
      ws.onmessage = (event) => {
        queue = queue
          .then(async () => {
            if (ws !== this.ws || this.stopped) return;
            const f = JSON.parse(String(event.data));
            if ((f.t === 'hello-ack' && f.hostOnline) || (f.t === 'host' && f.online)) {
              await start();
              return;
            }
            if (f.t === 'host' && !f.online) {
              this.clear();
              phase = 0;
              this.onStatus('offline');
              return;
            }
            if (f.t === 'hello-ack' && !f.hostOnline) {
              this.onStatus('offline');
              return;
            }
            if (f.t !== 'data') return;
            const m = JSON.parse(text(unb64(f.d)));
            if (phase === 1 && m.k === 'hello2') {
              keys = await sessionKeys(
                unb64(identity.clientId),
                await pub(ephemeral),
                unb64(m.e),
                await pub(identity.signing),
                unb64(identity.host),
                ephemeral.privateKey,
                unb64(m.e),
              );
              await verify(unb64(identity.host), m.sig, cat(utf8('host'), keys.th));
              this.data({
                k: 'hello3',
                sig: await sign(identity.signing.privateKey, cat(utf8('client'), keys.th)),
              });
              this.cipher = new Cipher(keys.okm.slice(0, 32), keys.okm.slice(32));
              phase = 2;
              delay = FIRST_RETRY_MS;
              clearTimeout(this.handshakeTimer);
              this.onStatus('ready');
              return;
            }
            if (phase !== 2 || m.k !== 'm') throw new Error('握手消息顺序错误');
            const value = (await this.cipher!.decode(m)) as Frame | undefined;
            if (!value) return;
            if (typeof value.id === 'number') {
              const p = this.pending.get(value.id);
              if (!p) return;
              clearTimeout(p.timer);
              this.pending.delete(value.id);
              if (value.ok) {
                p.onResult?.(value.r);
                p.resolve(value.r);
              } else p.reject(new Error(`${value.e.code}: ${value.e.message}`));
            } else if (value.ev) this.onEvent(value);
          })
          .catch((e) => {
            if (ws !== this.ws || this.stopped) return;
            this.onError(e);
            ws.close();
          });
      };
      ws.onerror = () => {
        if (ws === this.ws && !this.stopped) this.onError(new Error('连接中转失败'));
      };
      ws.onclose = (e) => {
        if (ws !== this.ws || this.stopped) return;
        this.clear();
        if (e.code === 4410) {
          this.stopped = true;
          this.onStatus('revoked');
          return;
        }
        if ([4400, 4401].includes(e.code)) {
          this.stopped = true;
          this.onError(new Error('中转拒绝连接，请检查协议版本与配对信息'));
          this.onStatus('closed');
          return;
        }
        this.onStatus('offline');
        this.retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      };
    };
    open();
  }
  request<T = any>(op: string, p: unknown = {}, onResult?: (value: T) => void): Promise<T> {
    if (!this.cipher) return Promise.reject(new Error('桌面端连接尚未就绪'));
    const cipher = this.cipher;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('操作等待超时，结果未知'));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer, onResult });
      this.outgoing = this.outgoing
        .then(async () => {
          if (this.cipher !== cipher) return;
          for (const frame of await cipher.encode({ id, op, p })) this.data(frame);
        })
        .catch((e) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(e);
          this.ws?.close();
        });
    });
  }
}
