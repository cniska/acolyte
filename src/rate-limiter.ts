import { field } from "./field";
import { HTTP_STATUS } from "./http-status";
import type { Provider } from "./provider-contract";
import { sleep } from "./sleep";

export type RateLimiterConfig = {
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
};

const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = { backoffBaseMs: 1_000, backoffMaxMs: 60_000 };

// The longest a provider's own retry-after is worth waiting out inside one call.
const MAX_SERVER_DELAY_MS = 60_000;

/** The provider budget a call draws on. Completions and embeddings are metered separately. */
export type RateLimitQuota = "completions" | "embeddings";

const sharedLimiters = new Map<string, RateLimiter>();

// Keyed by quota as well as provider: a limiter paces from the headers its own responses carried,
// and one shared across quotas would hold a completion turn for an embedding budget it never read.
export function sharedRateLimiter(provider: Provider, quota: RateLimitQuota = "completions"): RateLimiter {
  const key = `${provider}:${quota}`;
  const existing = sharedLimiters.get(key);
  if (existing) return existing;
  const limiter = createRateLimiter(DEFAULT_RATE_LIMITER_CONFIG);
  sharedLimiters.set(key, limiter);
  return limiter;
}

export function clearSharedRateLimiters(): void {
  sharedLimiters.clear();
}

function jitter(ms: number): number {
  return ms * (0.5 + Math.random() * 0.5);
}

function isRateLimitError(error: unknown): boolean {
  if (field(error, "status") === HTTP_STATUS.tooManyRequests) return true;
  if (field(error, "statusCode") === HTTP_STATUS.tooManyRequests) return true;
  const code = field(error, "code");
  return typeof code === "string" && code.toLowerCase() === "rate_limit_exceeded";
}

const OVERLOADED_CODES: ReadonlySet<string> = new Set(["overloaded_error", "service_unavailable"]);

// An exhausted balance arrives as a 429 the provider SDK marks retryable, but no wait refills it.
const EXHAUSTED_CODES: ReadonlySet<string> = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
]);

function errorCodes(error: unknown): string[] {
  const inner = field(field(error, "data"), "error");
  return [field(error, "code"), field(error, "type"), field(inner, "code"), field(inner, "type")]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
}

function isExhaustedError(error: unknown): boolean {
  return errorCodes(error).some((code) => EXHAUSTED_CODES.has(code));
}

function statusOf(error: unknown): unknown {
  return field(error, "status") ?? field(error, "statusCode");
}

/** Whether calling again could plausibly succeed: the provider failed, not the request. */
export function isRetryableProviderError(error: unknown): boolean {
  if (isExhaustedError(error)) return false;
  if (isRateLimitError(error)) return true;
  if (field(error, "isRetryable") === true) return true;
  const status = statusOf(error);
  if (typeof status === "number" && status >= HTTP_STATUS.internalServerError) return true;
  return errorCodes(error).some((code) => OVERLOADED_CODES.has(code));
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  const headers = field(error, "headers");
  const seconds = positiveNumber(field(headers, "retry-after"));
  if (seconds !== undefined) return seconds * 1_000;
  // OpenAI sends this instead on some endpoints, already in milliseconds.
  return positiveNumber(field(headers, "retry-after-ms"));
}

// Header names across providers (normalized to lowercase)
const HEADER_KEYS = {
  requestsRemaining: ["anthropic-ratelimit-requests-remaining", "x-ratelimit-remaining-requests"],
  tokensRemaining: ["anthropic-ratelimit-tokens-remaining", "x-ratelimit-remaining-tokens"],
  requestsReset: ["anthropic-ratelimit-requests-reset", "x-ratelimit-reset-requests"],
  tokensReset: ["anthropic-ratelimit-tokens-reset", "x-ratelimit-reset-tokens"],
} as const;

function findHeader(headers: Headers, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = headers.get(key);
    if (value !== null) return value;
  }
  return null;
}

function parseResetMs(value: string): number | undefined {
  // Anthropic sends ISO timestamps, OpenAI sends durations like "6m0s" or "1s"
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : undefined;
  }
  const durationMatch = value.match(/(?:(\d+)m)?(\d+(?:\.\d+)?)s/);
  if (durationMatch) {
    const minutes = Number.parseInt(durationMatch[1] ?? "0", 10);
    const seconds = Number.parseFloat(durationMatch[2] ?? "0");
    const ms = (minutes * 60 + seconds) * 1_000;
    return ms > 0 ? ms : undefined;
  }
  return undefined;
}

export type RateLimitState = {
  requestsRemaining: number | undefined;
  tokensRemaining: number | undefined;
  requestsResetMs: number | undefined;
  tokensResetMs: number | undefined;
};

export type RateLimiter = {
  beforeCall(abortSignal?: AbortSignal): Promise<void>;
  onResponse(headers: Headers): void;
  onError(error: unknown): { shouldRetry: boolean; delayMs: number };
  reset(): void;
  state(): RateLimitState;
};

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  let consecutiveFailures = 0;
  let requestsRemaining: number | undefined;
  let tokensRemaining: number | undefined;
  let requestsResetMs: number | undefined;
  let tokensResetMs: number | undefined;

  return {
    async beforeCall(abortSignal?: AbortSignal) {
      // Paced on the budget the last response reported. The wait is spent once: the reset is a
      // duration measured when it was read, so a call that never gets a response back — and so
      // never learns a newer budget — must not sleep the same window out all over again.
      const reqReset = requestsResetMs;
      const tokReset = tokensResetMs;
      if (requestsRemaining !== undefined && requestsRemaining <= 1 && reqReset !== undefined) {
        requestsRemaining = undefined;
        requestsResetMs = undefined;
        await sleep(jitter(reqReset), abortSignal);
      } else if (tokensRemaining !== undefined && tokensRemaining <= 0 && tokReset !== undefined) {
        tokensRemaining = undefined;
        tokensResetMs = undefined;
        await sleep(jitter(tokReset), abortSignal);
      }
    },

    onResponse(headers: Headers) {
      const reqRemaining = findHeader(headers, HEADER_KEYS.requestsRemaining);
      if (reqRemaining !== null) {
        const parsed = Number.parseInt(reqRemaining, 10);
        if (Number.isFinite(parsed)) requestsRemaining = parsed;
      }

      const tokRemaining = findHeader(headers, HEADER_KEYS.tokensRemaining);
      if (tokRemaining !== null) {
        const parsed = Number.parseInt(tokRemaining, 10);
        if (Number.isFinite(parsed)) tokensRemaining = parsed;
      }

      const reqReset = findHeader(headers, HEADER_KEYS.requestsReset);
      if (reqReset !== null) requestsResetMs = parseResetMs(reqReset);

      const tokReset = findHeader(headers, HEADER_KEYS.tokensReset);
      if (tokReset !== null) tokensResetMs = parseResetMs(tokReset);

      consecutiveFailures = 0;
    },

    onError(error: unknown): { shouldRetry: boolean; delayMs: number } {
      if (!isRetryableProviderError(error)) return { shouldRetry: false, delayMs: 0 };
      const serverDelay = retryAfterMs(error);
      // A provider asking for longer than this is telling us to come back later, not to hold the
      // turn open: honoring it verbatim would stall a run for as long as the header says.
      if (serverDelay !== undefined && serverDelay > MAX_SERVER_DELAY_MS) return { shouldRetry: false, delayMs: 0 };
      consecutiveFailures += 1;
      const backoff = Math.min(config.backoffMaxMs, config.backoffBaseMs * 2 ** (consecutiveFailures - 1));
      return { shouldRetry: true, delayMs: serverDelay ?? jitter(backoff) };
    },

    reset() {
      consecutiveFailures = 0;
    },

    state(): RateLimitState {
      return { requestsRemaining, tokensRemaining, requestsResetMs, tokensResetMs };
    },
  };
}

export type FetchFn = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export function createRateLimitFetch(limiter: RateLimiter, baseFetch: FetchFn): FetchFn {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    limiter.onResponse(response.headers);
    return response;
  };
}

export { isRateLimitError, retryAfterMs };
