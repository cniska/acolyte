import type { LifecycleSignal } from "./lifecycle-contract";

const SIGNAL_RE = /(?:^|\n)@signal\s+(done|no_op|blocked)\s*(?:\n|$)/;
const SIGNAL_PREFIXES = ["@signal done", "@signal no_op", "@signal blocked"] as const;

export function stripSignalLine(text: string): string {
  return extractLifecycleSignal(text).text;
}

export function extractLifecycleSignal(text: string): { signal?: LifecycleSignal; text: string } {
  const match = text.match(SIGNAL_RE);
  if (!match) return { text };
  const signal = match[1] as LifecycleSignal;
  const before = text.slice(0, match.index ?? 0).trimEnd();
  return { signal, text: before };
}

export type LifecycleTextStreamState = {
  pending: string;
  signal?: LifecycleSignal;
};

export function createLifecycleTextStreamState(): LifecycleTextStreamState {
  return { pending: "" };
}

// Returns the index within `text` from which to start buffering a potential @signal,
// or -1 if no buffering is needed.
// Includes the preceding newline so it is not emitted prematurely.
function findSignalBufferPoint(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== "@") continue;
    if (i !== 0 && text[i - 1] !== "\n") continue;
    const partial = text.slice(i);
    if (partial.includes("\n")) break; // newline already confirms or denies the signal
    if (SIGNAL_PREFIXES.some((p) => p.startsWith(partial))) {
      return i > 0 ? i - 1 : 0; // buffer from the preceding \n, or from @ if at position 0
    }
    break;
  }
  return -1;
}

export function appendLifecycleTextDelta(state: LifecycleTextStreamState, delta: string): string {
  // Signal already found — suppress everything remaining.
  if (state.signal) return "";

  state.pending += delta;

  // Check for a completed @signal line anywhere in pending.
  const match = state.pending.match(SIGNAL_RE);
  if (match) {
    const before = state.pending.slice(0, match.index ?? 0).trimEnd();
    state.signal = match[1] as LifecycleSignal;
    state.pending = "";
    return before;
  }

  // Check whether the end of pending could be the start of an @signal line.
  const bufferPoint = findSignalBufferPoint(state.pending);
  if (bufferPoint !== -1) {
    const visible = state.pending.slice(0, bufferPoint);
    state.pending = state.pending.slice(bufferPoint);
    return visible;
  }

  // No signal or partial signal — emit everything.
  const visible = state.pending;
  state.pending = "";
  return visible;
}

export function finalizeLifecycleText(state: LifecycleTextStreamState): { signal?: LifecycleSignal; text: string } {
  const pending = state.pending;
  state.pending = "";

  // If there is buffered pending text and no signal yet, check it now.
  // Handles partial buffers (e.g. "\n@sig" that never completed) and
  // signals at end-of-stream with no trailing newline.
  if (pending.length > 0 && !state.signal) {
    const parsed = extractLifecycleSignal(pending);
    if (parsed.signal) {
      state.signal = parsed.signal;
      return parsed;
    }
    return { text: parsed.text };
  }

  return { ...(state.signal ? { signal: state.signal } : {}), text: pending };
}
