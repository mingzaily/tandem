import { createHash } from "node:crypto";

export const tokenHash = (token: string) =>
  createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex");
