import { createECDH, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  aes,
  b64,
  cat,
  pairKeys,
  sessionKeys,
  utf8,
} from "../../pwa/src/lib/crypto.ts";
const scalar = (n: number) => {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(n, 28);
  return b;
};
function material(n: number) {
  const ec = createECDH("prime256v1");
  ec.setPrivateKey(scalar(n));
  const raw = ec.getPublicKey();
  return {
    raw,
    jwk: {
      kty: "EC",
      crv: "P-256",
      x: b64(raw.subarray(1, 33)),
      y: b64(raw.subarray(33)),
      d: b64(scalar(n)),
      ext: true,
    },
  };
}
const ec = material(1),
  eh = material(2),
  sc = material(3),
  sh = material(4);
const secret = new Uint8Array(32).fill(5),
  clientId = new Uint8Array(16).fill(6),
  token = new Uint8Array(32).fill(7);
const key = await crypto.subtle.importKey(
  "jwk",
  ec.jwk,
  { name: "ECDH", namedCurve: "P-256" },
  false,
  ["deriveBits"],
);
const pair = await pairKeys(
  ec.raw,
  sc.raw,
  eh.raw,
  sh.raw,
  key,
  eh.raw,
  secret,
);
const session = await sessionKeys(
  clientId,
  ec.raw,
  eh.raw,
  sc.raw,
  sh.raw,
  key,
  eh.raw,
);
// 固定测试 nonce；生产签名使用 WebCrypto 随机 nonce。
const order = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);
const mod = (n: bigint) => ((n % order) + order) % order;
function inverse(a: bigint) {
  let r = 1n,
    p = order - 2n;
  for (a = mod(a); p; p >>= 1n, a = mod(a * a)) if (p & 1n) r = mod(r * a);
  return r;
}
function signature(d: number, k: number, bytes: Uint8Array) {
  const r = mod(BigInt("0x" + material(k).raw.subarray(1, 33).toString("hex")));
  const z = BigInt("0x" + createHash("sha256").update(bytes).digest("hex"));
  const s = mod(inverse(BigInt(k)) * (z + r * BigInt(d)));
  return b64(
    Buffer.from(
      r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0"),
      "hex",
    ),
  );
}
const pairPlaintext = JSON.stringify({
  clientId: b64(clientId),
  token: b64(token),
});
const messagePlaintext = JSON.stringify({ id: 1, op: "tasks.list", p: {} });
const vector = {
  encoding:
    "base64url without padding; scalar and JWK d are 32-byte big-endian",
  privateKeys: { ec: ec.jwk, eh: eh.jwk, sc: sc.jwk, sh: sh.jwk },
  publicKeys: {
    ec: b64(ec.raw),
    eh: b64(eh.raw),
    sc: b64(sc.raw),
    sh: b64(sh.raw),
  },
  secret: b64(secret),
  clientId: b64(clientId),
  token: b64(token),
  pair: {
    th: b64(pair.th),
    okm: b64(pair.okm),
    macH: pair.macH,
    macC: pair.macC,
    code: pair.code,
    signatureNonce: b64(scalar(8)),
    signature: signature(3, 8, pair.th),
    plaintext: pairPlaintext,
    nonce: b64(new Uint8Array(12)),
    aad: "tandem-pair4",
    ciphertext: b64(
      await aes(
        pair.okm.slice(64),
        new Uint8Array(12),
        "tandem-pair4",
        utf8(pairPlaintext),
        true,
      ),
    ),
  },
  session: {
    th: b64(session.th),
    okm: b64(session.okm),
    hostSignatureNonce: b64(scalar(9)),
    hostSignature: signature(4, 9, cat(utf8("host"), session.th)),
    clientSignatureNonce: b64(scalar(10)),
    clientSignature: signature(3, 10, cat(utf8("client"), session.th)),
    plaintext: messagePlaintext,
    n: 0,
    nonce: b64(new Uint8Array(12)),
    aad: "tandem-m-v1",
    ciphertext: b64(
      await aes(
        session.okm.slice(0, 32),
        new Uint8Array(12),
        "tandem-m-v1",
        cat(new Uint8Array([0]), utf8(messagePlaintext)),
        true,
      ),
    ),
  },
};
await writeFile(
  new URL("../../docs/relay-test-vectors.json", import.meta.url),
  JSON.stringify(vector, null, 2) + "\n",
);
