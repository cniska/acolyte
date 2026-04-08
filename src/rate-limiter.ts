import type { Provider } from "./provider-contract";

export type RateLimiterConfig = {
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
};

const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = { backoffBaseMs: 1_000, backoffMaxMs: 60_000 };

const sharedLimiters = new Map<Provider, RateLimiter>();

export function sharedRateLimiter(provider: Provider): RateLimiter {
  const existing = sharedLimiters.get(provider);
  if (existing) return existing;
  const limiter = createRateLimiter(DEFAULT_RATE_LIMITER_CONFIG);
  sharedLimiters.set(provider, limiter);
  return limiter;
}

export function clearSharedRateLimiters(): void {
  sharedLimiters.clear();
}

function jitter(ms: number): number {
  return ms * (0.5 + Math.random() * 0.5);
}

function field(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  return key in obj ? (obj as Record<string, unknown>)[key] : undefined;
}

function isRateLimitError(error: unknown): boolean {
  if (field(error, "status") === 429) return true;
  if (field(error, "statusCode") === 429) return true;
  const code = field(error, "code");
  return typeof code === "string" && code.toLowerCase() === "rate_limit_exceeded";
}

function retryAfterMs(error: unknown): number | undefined {
  const headers = field(error, "headers");
  const retryAfter = field(headers, "retry-after");
  if (typeof retryAfter === "string") {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  }
  if (typeof retryAfter === "number" && retryAfter > 0) return retryAfter * 1_000;
  return undefined;
}

// Header names across providers (normalized to lowercase)
const HEADER_KEYS = {
  requestsRemaining: ["anthropic-ratelimit-requests-remaining", "x-ratelimit-remaining-requests"],
  tokensRemaining: ["anthropic-ratelimit-tokens-remaining", "x-ratelimit-remaining-tokens"],
  requestsReset: ["anthropic-ratelimit-requests-reset", "x-ratelimit-reset-requests"],
  tokensReset: ["anthropic-ratelimit-tokens-reset", "x-ratelimit-reset-tokens"],
  retryAfter: ["retry-after", "retry-after-ms"],
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
  beforeCall(): Promise<void>;
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
    async beforeCall() {
      // Pace based on remaining budget learned from previous responses
      const reqReset = requestsResetMs;
      const tokReset = tokensResetMs;
      if (requestsRemaining !== undefined && requestsRemaining <= 1 && reqReset !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, jitter(reqReset)));
      } else if (tokensRemaining !== undefined && tokensRemaining <= 0 && tokReset !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, jitter(tokReset)));
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
      if (!isRateLimitError(error)) return { shouldRetry: false, delayMs: 0 };
      consecutiveFailures += 1;
      const serverDelay = retryAfterMs(error);
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
