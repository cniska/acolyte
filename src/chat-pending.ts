import { useState } from "react";
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
  isPending: boolean;
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
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const hasIndicator = pendingState !== null;
  const isPending = hasIndicator && pendingState.kind !== "awaiting-input";
  const [pendingFrame, setPendingFrame] = useState(0);
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [runningUsage, setRunningUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  useSyncEffect(() => {
    if (isPending) {
      setPendingStartedAt((current) => current ?? Date.now());
    } else {
      setPendingStartedAt(null);
      if (!hasIndicator) setPendingFrame(0);
    }
  }, [isPending, hasIndicator]);

  useInterval(
    () => setPendingFrame((current) => nextPendingFrame(current, PENDING_PULSE_FRAMES)),
    hasIndicator ? PENDING_ANIMATION_INTERVAL_MS : null,
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
