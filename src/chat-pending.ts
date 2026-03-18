import { useState } from "react";
import { useThinkingAnimationEffect } from "./chat-effects";
import type { PendingState } from "./client-contract";
import { useSyncEffect } from "./tui/effects";

const THINKING_PULSE_FRAMES = 16;

export type PendingStateResult = {
  pendingState: PendingState | null;
  setPendingState: (next: PendingState | null) => void;
  isPending: boolean;
  thinkingFrame: number;
  thinkingStartedAt: number | null;
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
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
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

  useThinkingAnimationEffect(isPending, THINKING_PULSE_FRAMES, setThinkingFrame);

  return {
    pendingState,
    setPendingState,
    isPending,
    thinkingFrame,
    thinkingStartedAt,
    ctrlCPending,
    setCtrlCPending,
    queuedMessages,
    setQueuedMessages,
    runningUsage,
    setRunningUsage,
  };
}
