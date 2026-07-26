import { useCallback, useRef, useState } from "react";
import type { PendingState } from "./client-contract";
import { useInterval, useSyncEffect } from "./tui/effects";

const PENDING_PULSE_FRAMES = 16;
const PENDING_ANIMATION_INTERVAL_MS = 60;

function nextPendingFrame(current: number, frameCount: number): number {
  return (current + 1) % frameCount;
}

export type PendingStateResult = {
  pendingState: PendingState | null;
  setPendingState: (next: PendingState | null) => void;
  /** Live: true from the moment pending is set, before React commits the render. */
  isPending: () => boolean;
  pendingFrame: number;
  pendingStartedAt: number | null;
  ctrlCPending: boolean;
  setCtrlCPending: (next: boolean) => void;
  queuedMessages: string[];
  setQueuedMessages: (updater: (current: string[]) => string[]) => void;
  runningUsage: { inputTokens: number; outputTokens: number } | null;
  setRunningUsage: (next: { inputTokens: number; outputTokens: number } | null) => void;
};

export function usePendingState(): PendingStateResult {
  const [pendingState, setPendingStateValue] = useState<PendingState | null>(null);
  // The turn-end drain resubmits the queued message before React commits the cleared
  // pending state, so the guard it passes through cannot read a render-derived value.
  const pendingStateRef = useRef<PendingState | null>(null);
  const setPendingState = useCallback((next: PendingState | null) => {
    pendingStateRef.current = next;
    setPendingStateValue(next);
  }, []);
  const isPending = useCallback(() => pendingStateRef.current !== null, []);
  const showPending = pendingState !== null;
  const [pendingFrame, setPendingFrame] = useState(0);
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [runningUsage, setRunningUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  useSyncEffect(() => {
    if (showPending) {
      setPendingStartedAt((current) => current ?? Date.now());
    } else {
      setPendingStartedAt(null);
      setPendingFrame(0);
    }
  }, [showPending]);

  useInterval(
    () => setPendingFrame((current) => nextPendingFrame(current, PENDING_PULSE_FRAMES)),
    showPending ? PENDING_ANIMATION_INTERVAL_MS : null,
  );

  return {
    pendingState,
    setPendingState,
    isPending,
    pendingFrame,
    pendingStartedAt,
    ctrlCPending,
    setCtrlCPending,
    queuedMessages,
    setQueuedMessages,
    runningUsage,
    setRunningUsage,
  };
}
