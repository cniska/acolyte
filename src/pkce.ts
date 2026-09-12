export type PkceCodes = { verifier: string; challenge: string };

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** The S256 pair every browser handoff here uses: the challenge travels, the verifier is proof. */
export function createPkce(): PkceCodes {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: challengeFor(verifier) };
}

/**
 * The value that binds a callback to the handoff that asked for it. It is the only check standing
 * between the loopback server and anything else on the machine, so it is drawn from the same random
 * source as the verifier rather than from an id meant to be short enough to read out.
 */
export function createHandoffState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export function challengeFor(verifier: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(verifier);
  return hasher.digest("base64url");
}
