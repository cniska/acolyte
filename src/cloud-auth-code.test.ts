import { describe, expect, mock, test } from "bun:test";
import { exchangeAuthCode } from "./cloud-auth-code";
import { errorCode } from "./error-contract";

const BASE = "https://cloud.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("exchanging the code", () => {
  test("sends the code with its verifier and returns the account's tokens", async () => {
    const fetchFn = mock(async () =>
      jsonResponse({ token: "access-1", refresh: "refresh-1", username: "octo", email: "octo@example.com" }),
    );

    const tokens = await exchangeAuthCode(BASE, "code-1", "verifier-1", fetchFn as unknown as typeof fetch);

    expect(tokens).toEqual({ token: "access-1", refresh: "refresh-1", email: "octo@example.com" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cloud.example.com/api/v1/auth/cli-token/exchange");
    expect(JSON.parse(String(init.body))).toEqual({ code: "code-1", verifier: "verifier-1" });
  });

  test("a cloud with no exchange route is named as too old", async () => {
    const fetchFn = mock(async () => new Response("Not found", { status: 404 }));

    const error = await exchangeAuthCode(BASE, "c", "v", fetchFn as unknown as typeof fetch).catch((e) => e);

    expect(errorCode(error)).toBe("E_LOGIN_EXCHANGE_UNSUPPORTED");
  });

  test("a refused exchange is a refusal, not a missing route", async () => {
    const fetchFn = mock(async () => jsonResponse({ error: "Invalid code" }, 401));

    const error = await exchangeAuthCode(BASE, "c", "v", fetchFn as unknown as typeof fetch).catch((e) => e);

    expect(errorCode(error)).toBe("E_LOGIN_EXCHANGE_REFUSED");
  });

  test("an answer missing either token is refused rather than half-stored", async () => {
    const fetchFn = mock(async () => jsonResponse({ token: "access-1", email: "octo@example.com" }));

    const error = await exchangeAuthCode(BASE, "c", "v", fetchFn as unknown as typeof fetch).catch((e) => e);

    expect(errorCode(error)).toBe("E_LOGIN_EXCHANGE_REFUSED");
  });
});
