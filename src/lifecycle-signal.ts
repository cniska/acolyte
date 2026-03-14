import type { LifecycleSignal } from "./lifecycle-contract";

export function extractLifecycleSignal(text: string): { signal?: LifecycleSignal; text: string } {
  const match = text.match(/(?:^|\n)@signal\s+(done|no_op|blocked)\s*(?:\n|$)/);
  if (!match) return { text };
  const signal = match[1] as LifecycleSignal;
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index! + match[0].length).trimStart();
  const stripped = [before, after].filter(Boolean).join("\n");
  return { signal, text: stripped };
}

export type LifecycleTextStreamState = {
  pending: string;
  resolved: boolean;
  signal?: LifecycleSignal;
};

export function createLifecycleTextStreamState(): LifecycleTextStreamState {
  return { pending: "", resolved: false };
}

export function appendLifecycleTextDelta(state: LifecycleTextStreamState, delta: string): string {
  if (state.resolved) return delta;
  state.pending += delta;

  const signalPrefix = "@signal ";
  if (!state.pending.startsWith("@")) {
    state.resolved = true;
    const visible = state.pending;
    state.pending = "";
    return visible;
  }

  if (!signalPrefix.startsWith(state.pending) && !state.pending.startsWith(signalPrefix)) {
    state.resolved = true;
    const visible = state.pending;
    state.pending = "";
    return visible;
  }

  if (!state.pending.startsWith(signalPrefix)) return "";
  const newlineIndex = state.pending.indexOf("\n");
  if (newlineIndex === -1) return "";

  const signalLine = state.pending.slice(0, newlineIndex + 1);
  const parsed = extractLifecycleSignal(signalLine);
  state.resolved = true;
  if (!parsed.signal) {
    const visible = state.pending;
    state.pending = "";
    return visible;
  }

  state.signal = parsed.signal;
  const visible = state.pending.slice(signalLine.length);
  state.pending = "";
  return visible;
}

export function finalizeLifecycleText(state: LifecycleTextStreamState): { signal?: LifecycleSignal; text: string } {
  if (state.resolved) {
    const text = state.pending;
    state.pending = "";
    return { ...(state.signal ? { signal: state.signal } : {}), text };
  }

  const parsed = extractLifecycleSignal(state.pending);
  state.pending = "";
  state.resolved = true;
  if (parsed.signal) {
    state.signal = parsed.signal;
    return parsed;
  }
  return { text: parsed.text };
}
