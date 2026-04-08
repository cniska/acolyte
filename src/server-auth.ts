import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const hashA = new Bun.CryptoHasher("sha256").update(a).digest();
  const hashB = new Bun.CryptoHasher("sha256").update(b).digest();
  // node:crypto — Bun has no native timingSafeEqual
  return timingSafeEqual(Buffer.from(hashA), Buffer.from(hashB));
}

export function hasValidAuth(req: Request, apiKey: string | undefined): boolean {
  if (!apiKey) return true;

  const auth = req.headers.get("authorization");
  if (auth && safeEqual(auth, `Bearer ${apiKey}`)) return true;

  const protocol = req.headers.get("sec-websocket-protocol") ?? "";
  for (const proto of protocol.split(",")) {
    const trimmed = proto.trim();
    if (trimmed.startsWith("bearer.") && safeEqual(trimmed.slice(7), apiKey)) return true;
  }

  return false;
}
