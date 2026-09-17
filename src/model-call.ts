import type { EmbeddingModelV4, LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { log } from "./log";
import type { RateLimiter } from "./rate-limiter";
import { sleep } from "./sleep";

/**
 * The one way this codebase calls a model. Every call site shares the same two hazards — a provider
 * that is momentarily unavailable, and a connection that opens and then delivers nothing — so they
 * are answered here once rather than per caller, where a missing answer is invisible.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
// A provider that has sent nothing for this long is not slow, it is gone: the observed case is a
// machine suspended mid-call, whose socket stays open and never delivers another byte.
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
// An embedding is one short round trip, so it has no reason to outlast a slow but working request.
const DEFAULT_EMBED_TIMEOUT_MS = 30_000;

function timeoutError(message: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = LIFECYCLE_ERROR_CODES.timeout;
  return error;
}

function isConnectTimeout(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === LIFECYCLE_ERROR_CODES.timeout;
}

export type ModelCallRequest = Parameters<LanguageModelV4["doStream"]>[0];

export type ModelCallOptions = {
  client: LanguageModelV4;
  limiter: RateLimiter;
  request: ModelCallRequest;
  /** The caller's own cancellation, kept live alongside the idle deadline. */
  abortSignal?: AbortSignal;
  idleTimeoutMs?: number;
  maxAttempts?: number;
  /** Names the call in the trace, so a retry can be told from a fresh call. */
  label?: string;
};

/**
 * Fails a read that waits longer than the deadline for its next part. The timer restarts on every
 * part, so a long answer is never cut off for being long — only for having stopped.
 */
function withIdleDeadline(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  idleTimeoutMs: number,
): ReadableStream<LanguageModelV4StreamPart> {
  const reader = stream.getReader();
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(`model stream idle for ${idleTimeoutMs}ms`)), idleTimeoutMs);
      });
      try {
        const { done, value } = await Promise.race([reader.read(), idle]);
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        reader.cancel().catch(() => {});
        controller.error(error);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Opens a model stream, retrying while the provider is the thing that failed, and hands back a
 * stream that cannot hang. The limiter owns the backoff, so waiting stays consistent per provider.
 */
async function withProviderRetry<T>(
  limiter: RateLimiter,
  maxAttempts: number,
  label: string | undefined,
  abortSignal: AbortSignal | undefined,
  call: () => PromiseLike<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await limiter.beforeCall(abortSignal);
    try {
      const result = await call();
      limiter.reset();
      return result;
    } catch (error) {
      // A stream that never opened is the provider being momentarily unavailable, which is what this
      // loop is for; the limiter cannot see that, because the deadline is ours rather than theirs.
      const recovery = isConnectTimeout(error) ? { shouldRetry: true, delayMs: 0 } : limiter.onError(error);
      if (!recovery.shouldRetry || attempt >= maxAttempts) throw error;
      log.debug("model.call.retry", { label, attempt, delay_ms: recovery.delayMs });
      await sleep(recovery.delayMs, abortSignal);
    }
  }
}

async function openStream(
  client: LanguageModelV4,
  request: ModelCallRequest,
  abortSignal: AbortSignal | undefined,
  connectTimeoutMs: number,
): Promise<Awaited<ReturnType<LanguageModelV4["doStream"]>>> {
  const connect = new AbortController();
  const timer = setTimeout(
    () => connect.abort(timeoutError(`model stream did not open within ${connectTimeoutMs}ms`)),
    connectTimeoutMs,
  );
  // Composed rather than forwarded by hand: the caller's signal outlives this call and must still
  // reach the provider mid-answer, so a listener added here would never be safe to remove.
  const signal = abortSignal ? AbortSignal.any([abortSignal, connect.signal]) : connect.signal;
  try {
    return await client.doStream({ ...request, abortSignal: signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function streamModelCall(
  options: ModelCallOptions,
): Promise<Awaited<ReturnType<LanguageModelV4["doStream"]>>> {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const result = await withProviderRetry(
    options.limiter,
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    options.label,
    options.abortSignal,
    () => openStream(options.client, options.request, options.abortSignal, idleTimeoutMs),
  );
  return { ...result, stream: withIdleDeadline(result.stream, idleTimeoutMs) };
}

export type EmbedCallOptions = {
  client: EmbeddingModelV4;
  limiter: RateLimiter;
  values: readonly string[];
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  label?: string;
};

/**
 * An embedding call, paced and retried like every other model call. It matters more than it looks:
 * a dropped embedding does not fail loudly, it stores a memory that similarity search cannot reach.
 */
export async function embedModelCall(options: EmbedCallOptions): Promise<number[][]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const result = await withProviderRetry(
    options.limiter,
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    options.label,
    options.abortSignal,
    () =>
      options.client.doEmbed({
        values: [...options.values],
        abortSignal: options.abortSignal
          ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      }),
  );
  return result.embeddings;
}
