import { describe, expect, test } from "bun:test";
import {
  clearSharedRateLimiters,
  createRateLimiter,
  createRateLimitFetch,
  isRateLimitError,
  type RateLimiterConfig,
  retryAfterMs,
  sharedRateLimiter,
} from "./rate-limiter";

const FAST: RateLimiterConfig = { backoffBaseMs: 100, backoffMaxMs: 1_000 };

describe("isRateLimitError", () => {
  test("detects 429 status", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  test("detects rate_limit_exceeded code", () => {
    expect(isRateLimitError({ code: "rate_limit_exceeded" })).toBe(true);
    expect(isRateLimitError({ code: "RATE_LIMIT_EXCEEDED" })).toBe(true);
  });

  test("rejects unrelated errors", () => {
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError({ code: "server_error" })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError("string")).toBe(false);
  });
});

describe("retryAfterMs", () => {
  test("parses retry-after header in seconds", () => {
    expect(retryAfterMs({ headers: { "retry-after": "2" } })).toBe(2_000);
    expect(retryAfterMs({ headers: { "retry-after": "0.5" } })).toBe(500);
  });

  test("parses numeric retry-after", () => {
    expect(retryAfterMs({ headers: { "retry-after": 3 } })).toBe(3_000);
  });

  test("returns undefined for missing or invalid headers", () => {
    expect(retryAfterMs({ headers: {} })).toBeUndefined();
    expect(retryAfterMs({})).toBeUndefined();
    expect(retryAfterMs({ headers: { "retry-after": "invalid" } })).toBeUndefined();
  });
});

describe("createRateLimiter", () => {
  test("beforeCall resolves immediately with no prior state", async () => {
    const limiter = createRateLimiter(FAST);
    const start = Date.now();
    await limiter.beforeCall();
    expect(Date.now() - start).toBeLessThan(50);
  });

  test("onResponse updates state from Anthropic headers", () => {
    const limiter = createRateLimiter(FAST);
    const headers = new Headers({
      "anthropic-ratelimit-requests-remaining": "10",
      "anthropic-ratelimit-tokens-remaining": "5000",
    });
    limiter.onResponse(headers);
    expect(limiter.state().requestsRemaining).toBe(10);
    expect(limiter.state().tokensRemaining).toBe(5000);
  });

  test("onResponse updates state from OpenAI headers", () => {
    const limiter = createRateLimiter(FAST);
    const headers = new Headers({
      "x-ratelimit-remaining-requests": "25",
      "x-ratelimit-remaining-tokens": "80000",
    });
    limiter.onResponse(headers);
    expect(limiter.state().requestsRemaining).toBe(25);
    expect(limiter.state().tokensRemaining).toBe(80000);
  });

  test("delays when requests remaining is exhausted", async () => {
    const limiter = createRateLimiter(FAST);
    limiter.onResponse(
      new Headers({
        "anthropic-ratelimit-requests-remaining": "0",
        "anthropic-ratelimit-requests-reset": "1s",
      }),
    );
    const delayed = limiter.beforeCall();
    const result = await Promise.race([
      delayed.then(() => "completed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("waited"), 50)),
    ]);
    expect(result).toBe("waited");
  });

  test("delays when tokens remaining is exhausted", async () => {
    const limiter = createRateLimiter(FAST);
    limiter.onResponse(
      new Headers({
        "anthropic-ratelimit-tokens-remaining": "0",
        "anthropic-ratelimit-tokens-reset": "2s",
      }),
    );
    const delayed = limiter.beforeCall();
    const result = await Promise.race([
      delayed.then(() => "completed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("waited"), 50)),
    ]);
    expect(result).toBe("waited");
  });

  test("onError returns shouldRetry for rate limit errors", () => {
    const limiter = createRateLimiter(FAST);
    const result = limiter.onError({ status: 429 });
    expect(result.shouldRetry).toBe(true);
    expect(result.delayMs).toBeGreaterThan(0);
  });

  test("onError returns no retry for non-rate-limit errors", () => {
    const limiter = createRateLimiter(FAST);
    const result = limiter.onError({ status: 500 });
    expect(result.shouldRetry).toBe(false);
    expect(result.delayMs).toBe(0);
  });

  test("onError uses retry-after header when available", () => {
    const limiter = createRateLimiter(FAST);
    const result = limiter.onError({ status: 429, headers: { "retry-after": "5" } });
    expect(result.shouldRetry).toBe(true);
    expect(result.delayMs).toBe(5_000);
  });

  test("onError increases backoff on consecutive failures", () => {
    const limiter = createRateLimiter(FAST);
    const first = limiter.onError({ status: 429 });
    const second = limiter.onError({ status: 429 });
    expect(second.delayMs).toBeGreaterThanOrEqual(first.delayMs);
  });

  test("onResponse resets consecutive failure count", () => {
    const limiter = createRateLimiter(FAST);
    limiter.onError({ status: 429 });
    limiter.onError({ status: 429 });
    limiter.onError({ status: 429 });
    limiter.onResponse(new Headers());
    const result = limiter.onError({ status: 429 });
    expect(result.delayMs).toBeLessThanOrEqual(FAST.backoffBaseMs);
  });
});

describe("createRateLimitFetch", () => {
  test("passes response through and calls onResponse", async () => {
    const limiter = createRateLimiter(FAST);
    const mockResponse = new Response("ok", {
      headers: { "x-ratelimit-remaining-requests": "42" },
    });
    const mockFetch = async () => mockResponse;
    const wrappedFetch = createRateLimitFetch(limiter, mockFetch);
    const result = await wrappedFetch("https://example.com");
    expect(result).toBe(mockResponse);
    expect(limiter.state().requestsRemaining).toBe(42);
  });
});

describe("sharedRateLimiter", () => {
  test("returns same instance for same provider", () => {
    clearSharedRateLimiters();
    const a = sharedRateLimiter("anthropic");
    const b = sharedRateLimiter("anthropic");
    expect(a).toBe(b);
  });

  test("returns different instances for different providers", () => {
    clearSharedRateLimiters();
    const a = sharedRateLimiter("anthropic");
    const o = sharedRateLimiter("openai");
    expect(a).not.toBe(o);
  });
});
