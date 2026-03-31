import { describe, expect, test } from "bun:test";
import {
  createRateLimiter,
  defaultRateLimiterConfig,
  isRateLimitError,
  type RateLimiterConfig,
  retryAfterMs,
} from "./rate-limiter";

const FAST: RateLimiterConfig = {
  maxRequestsPerMinute: 3,
  maxTokensPerMinute: 0,
  backoffBaseMs: 100,
  backoffMaxMs: 1_000,
};

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
  test("allows calls within limit", async () => {
    const limiter = createRateLimiter(FAST);
    const start = Date.now();
    await limiter.beforeCall();
    await limiter.beforeCall();
    await limiter.beforeCall();
    expect(Date.now() - start).toBeLessThan(100);
  });

  test("delays when token usage exceeds limit", async () => {
    const limiter = createRateLimiter({
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 1_000,
      backoffBaseMs: 100,
      backoffMaxMs: 1_000,
    });
    await limiter.beforeCall();
    limiter.recordUsage(900);
    await limiter.beforeCall();
    limiter.recordUsage(200);
    // Next call should block — 1100 tokens in window exceeds 1000 limit
    const delayed = limiter.beforeCall();
    const result = await Promise.race([
      delayed.then(() => "completed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("waited"), 50)),
    ]);
    expect(result).toBe("waited");
  });

  test("delays when calls exceed limit", async () => {
    const limiter = createRateLimiter({
      maxRequestsPerMinute: 2,
      maxTokensPerMinute: 0,
      backoffBaseMs: 100,
      backoffMaxMs: 1_000,
    });
    await limiter.beforeCall();
    await limiter.beforeCall();
    // Third call should block since limit is 2 per minute
    const delayed = limiter.beforeCall();
    // Cancel via racing with a short timeout to avoid actually waiting 60s
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

  test("reset clears consecutive failure count", () => {
    const limiter = createRateLimiter(FAST);
    limiter.onError({ status: 429 });
    limiter.onError({ status: 429 });
    limiter.onError({ status: 429 });
    limiter.reset();
    const result = limiter.onError({ status: 429 });
    expect(result.delayMs).toBeLessThanOrEqual(FAST.backoffBaseMs);
  });
});

describe("defaultRateLimiterConfig", () => {
  test("returns per-provider defaults", () => {
    const anthropic = defaultRateLimiterConfig("anthropic");
    expect(anthropic.maxRequestsPerMinute).toBe(50);

    const openai = defaultRateLimiterConfig("openai");
    expect(openai.maxRequestsPerMinute).toBe(60);

    const google = defaultRateLimiterConfig("google");
    expect(google.maxRequestsPerMinute).toBe(60);
  });
});
