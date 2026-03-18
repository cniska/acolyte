import { type EffectCallback, useEffect, useRef } from "react";

/**
 * Run an effect exactly once on mount. This is the only sanctioned way to
 * call `useEffect` in chat-layer code — prefer derived state, event handlers,
 * or render-time adjustments for everything else.
 */
export function useMountEffect(effect: EffectCallback): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;
  useEffect(() => effectRef.current(), []);
}

/**
 * Run a callback on a recurring interval. Pass `null` as `delayMs` to pause.
 * The callback is always read from a ref so the interval is never torn down
 * just because the callback identity changed.
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

/**
 * Run an async effect with automatic cancellation. The `cancelled` flag is
 * set when the effect is cleaned up — the caller should check it after every
 * `await` and bail if true.
 *
 * This is the sanctioned way to perform async work that depends on reactive
 * values. For mount-only async work, prefer `useMountEffect`.
 */
/**
 * Run a synchronous side effect when dependencies change. Use for state-sync
 * cases where render-time setState would cause infinite loops (e.g. syncing
 * derived arrays that produce new references each render).
 */
export function useSyncEffect(effect: () => void, deps: readonly unknown[]): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    effectRef.current();
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are caller-managed
  }, deps);
}

export function useAsyncEffect(effect: (cancelled: () => boolean) => Promise<void>, deps: readonly unknown[]): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    let cancel = false;
    void effectRef.current(() => cancel);
    return () => {
      cancel = true;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are caller-managed
  }, deps);
}
