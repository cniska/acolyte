/**
 * Waits, and gives up the moment the caller cancels. Every wait this codebase makes is pacing in
 * front of a provider — a backoff can run to a whole retry-after — so a wait that ignored the
 * signal would hold a cancelled turn open for all of it.
 */
export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) return Promise.reject(abortSignal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortSignal?.reason);
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}
