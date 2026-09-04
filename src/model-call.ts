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
      const recovery = limiter.onError(error);
      if (!recovery.shouldRetry || attempt >= maxAttempts) throw error;
      log.debug("model.call.retry", { label, attempt, delay_ms: recovery.delayMs });
      await sleep(recovery.delayMs, abortSignal);
    }
  }
}

/**
 * Opens the stream under the same deadline that later bounds reading it, because a provider can
 * accept the connection and then send no headers at all — a stall the stream's own timer never sees,
 * since there is no stream yet. The deadline covers only the opening; once headers arrive the timer
 * is dropped and a long healthy answer runs as long as it needs. The caller's own cancellation stays
 * live for the whole call, so aborting mid-answer still reaches the provider.
 */
async function openStream(
  client: LanguageModelV4,
  request: ModelCallRequest,
  abortSignal: AbortSignal | undefined,
  connectTimeoutMs: number,
): Promise<Awaited<ReturnType<LanguageModelV4["doStream"]>>> {
  const controller = new AbortController();
  abortSignal?.addEventListener("abort", () => controller.abort(abortSignal.reason), { once: true });
  if (abortSignal?.aborted) controller.abort(abortSignal.reason);
  const timer = setTimeout(
    () => controller.abort(timeoutError(`model stream did not open within ${connectTimeoutMs}ms`)),
    connectTimeoutMs,
  );
  try {
    return await client.doStream({ ...request, abortSignal: controller.signal });
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
  /** The caller's own cancellation, kept live alongside the per-attempt deadline. */
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
    // A fresh deadline per attempt, so a retry gets the whole round trip rather than what is left.
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
