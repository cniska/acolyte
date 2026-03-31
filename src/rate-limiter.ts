import type { Provider } from "./provider-contract";

export type RateLimiterConfig = {
  readonly maxRequestsPerMinute: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
};

const PROVIDER_DEFAULTS: Record<Provider, RateLimiterConfig> = {
  anthropic: { maxRequestsPerMinute: 50, backoffBaseMs: 1_000, backoffMaxMs: 60_000 },
  openai: { maxRequestsPerMinute: 60, backoffBaseMs: 1_000, backoffMaxMs: 60_000 },
  google: { maxRequestsPerMinute: 60, backoffBaseMs: 1_000, backoffMaxMs: 60_000 },
};

export function defaultRateLimiterConfig(provider: Provider): RateLimiterConfig {
  return PROVIDER_DEFAULTS[provider];
}

function jitter(ms: number): number {
  return ms * (0.5 + Math.random() * 0.5);
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = "status" in error ? (error as { status?: unknown }).status : undefined;
  if (status === 429) return true;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "rate_limit_exceeded" || code === "RATE_LIMIT_EXCEEDED";
}

function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = "headers" in error ? (error as { headers?: unknown }).headers : undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  const retryAfter = "retry-after" in headers ? (headers as Record<string, unknown>)["retry-after"] : undefined;
  if (typeof retryAfter === "string") {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  }
  if (typeof retryAfter === "number" && retryAfter > 0) return retryAfter * 1_000;
  return undefined;
}

export type RateLimiter = {
  beforeCall(): Promise<void>;
  onError(error: unknown): { shouldRetry: boolean; delayMs: number };
  reset(): void;
};

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const timestamps: number[] = [];
  let consecutiveFailures = 0;

  function pruneWindow() {
    const cutoff = Date.now() - 60_000;
    while (timestamps.length > 0 && (timestamps[0] ?? 0) < cutoff) timestamps.shift();
  }

  return {
    async beforeCall() {
      pruneWindow();
      if (timestamps.length >= config.maxRequestsPerMinute) {
        const oldest = timestamps[0] ?? Date.now();
        const waitMs = Math.max(0, oldest + 60_000 - Date.now());
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, jitter(waitMs)));
        pruneWindow();
      }
      timestamps.push(Date.now());
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
  };
}

export { isRateLimitError, retryAfterMs };
