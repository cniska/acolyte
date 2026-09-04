import { describe, expect, mock, test } from "bun:test";
import { CloudSession } from "./cloud-session";

const BASE = "https://api.example.com";

/** A token in the shape the cloud mints, expiring `secondsFromNow` from the fixed clock below. */
function tokenExpiringIn(secondsFromNow: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(NOW / 1000) + secondsFromNow;
  return `${part({ alg: "EdDSA" })}.${part({ sub: "user_1", scope: "user", exp })}.c2ln`;
}

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createSession(options: {
  token: string;
  refreshToken?: string;
  respond?: () => Response;
  persisted?: string[];
}) {
  const fetchFn = mock(async () => options.respond?.() ?? jsonResponse({ token: "renewed-token" }));
  const session = new CloudSession({
    baseUrl: BASE,
    token: options.token,
    renewal: options.refreshToken
      ? {
          refreshToken: options.refreshToken,
          persistToken: async (next) => {
            options.persisted?.push(next);
          },
        }
      : undefined,
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => NOW,
  });
  return { session, fetchFn };
}

describe("cloud session", () => {
  test("a live token is sent as it is", async () => {
    const token = tokenExpiringIn(3600);
    const { session, fetchFn } = createSession({ token, refreshToken: "refresh-1" });

    expect(await session.accessToken()).toBe(token);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("an expiring token is renewed and the new one stored before it is used", async () => {
    const persisted: string[] = [];
    const { session, fetchFn } = createSession({
      token: tokenExpiringIn(30),
      refreshToken: "refresh-1",
      persisted,
    });

    expect(await session.accessToken()).toBe("renewed-token");
    expect(persisted).toEqual(["renewed-token"]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/v1/auth/refresh");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ refreshToken: "refresh-1" });
  });

  test("an expired token is renewed", async () => {
    const { session } = createSession({ token: tokenExpiringIn(-3600), refreshToken: "refresh-1" });

    expect(await session.accessToken()).toBe("renewed-token");
  });

  test("concurrent callers share one exchange", async () => {
    const { session, fetchFn } = createSession({ token: tokenExpiringIn(-1), refreshToken: "refresh-1" });

    const tokens = await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);

    expect(tokens).toEqual(["renewed-token", "renewed-token", "renewed-token"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("a session with no refresh token keeps the token it was given", async () => {
    const token = tokenExpiringIn(-1);
    const { session, fetchFn } = createSession({ token });

    expect(await session.renew()).toBe(false);
    expect(await session.accessToken()).toBe(token);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("a refused exchange reports failure and keeps the spent token", async () => {
    const token = tokenExpiringIn(-1);
    const persisted: string[] = [];
    const { session } = createSession({
      token,
      refreshToken: "refresh-1",
      respond: () => jsonResponse({ error: "Invalid token" }, 401),
      persisted,
    });

    expect(await session.renew()).toBe(false);
    expect(await session.accessToken()).toBe(token);
    expect(persisted).toEqual([]);
  });

  test("a token with no expiry claim is never renewed on its own", async () => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${part({ alg: "EdDSA" })}.${part({ sub: "user_1", scope: "user" })}.c2ln`;
    const { session, fetchFn } = createSession({ token, refreshToken: "refresh-1" });

    expect(await session.accessToken()).toBe(token);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("a renewal that answers without a token fails loudly", async () => {
    const { session } = createSession({
      token: tokenExpiringIn(-1),
      refreshToken: "refresh-1",
      respond: () => jsonResponse({ ok: true }),
    });

    await expect(session.renew()).rejects.toThrow("returned no token");
  });
});
