import { useState } from "react";
import { usePendingAnimationEffect } from "./chat-effects";
import type { PendingState } from "./client-contract";
import { useSyncEffect } from "./tui/effects";

const PENDING_PULSE_FRAMES = 16;

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
  const isPending = pendingState !== null;
  const [pendingFrame, setThinkingFrame] = useState(0);
  const [pendingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [runningUsage, setRunningUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  useSyncEffect(() => {
    if (isPending) {
      setThinkingStartedAt((current) => current ?? Date.now());
    } else {
      setThinkingStartedAt(null);
      setThinkingFrame(0);
    }
  }, [isPending]);

  usePendingAnimationEffect(isPending, PENDING_PULSE_FRAMES, setThinkingFrame);

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
