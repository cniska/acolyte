import { useCallback, useRef, useState } from "react";
import { appConfig } from "./app-config";
import type { ChatRow } from "./chat-contract";
import { useSuggestions } from "./chat-effects";
import { processInputChange, processInputSubmit } from "./chat-input-handlers";
import { useInputState } from "./chat-input-state";
import { useChatKeybindings } from "./chat-keybindings";
import { shownBranch, shownCwd } from "./chat-layout";
import { createMessageHandler } from "./chat-message-handler";
import { suggestModels } from "./chat-model-autocomplete";
import { usePendingState } from "./chat-pending";
import { type PickerState, pickerItemCount } from "./chat-picker";
import { createPickerHandlers } from "./chat-picker-handlers";
import { type PromotedItem, usePromotion } from "./chat-promotion";
import { createMessage, toRows } from "./chat-session";
import { createSkillActivator } from "./chat-skill-activator";
import { enqueueQueuedMessage, resolveQueueSubmit } from "./chat-submit";
import type { Client, PendingState } from "./client-contract";
import { nowIso } from "./datetime";
import { log } from "./log";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { loadSkills } from "./skill-ops";
import { useAsyncEffect, useMountEffect, useSyncEffect } from "./tui/effects";

const QUEUE_DELIVERY_POLICY = "one-at-a-time" as const;

export interface ChatAppProps {
  client: Client;
  session: Session;
  sessionState: SessionState;
  persist: () => Promise<void>;
  onSessionChange?: (next: Session) => void;
  version: string;
}

export interface ChatStateResult {
  promotedRows: PromotedItem[];
  rows: ChatRow[];
  pendingState: PendingState | null;
  pendingFrame: number;
  pendingStartedAt: number | null;
  queuedMessages: string[];
  runningUsage: { inputTokens: number; outputTokens: number } | null;
  picker: PickerState | null;
  value: string;
  inputRevision: number;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showHelp: boolean;
  ctrlCPending: boolean;
  activeSessionId: string | undefined;
  footerContext: string;
  handleInputChange: (next: string) => void;
  handleInputSubmit: (next: string) => void;
  handlePickerQueryChange: (query: string) => void;
  handlePickerSubmit: () => void;
  onCursorLine: (line: number) => void;
}

export function useChatState(props: ChatAppProps, exit: () => void): ChatStateResult {
  const { client, session, sessionState, persist } = props;

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const updateSession = useCallback(
    (next: Session) => {
      setCurrentSession(next);
      props.onSessionChange?.(next);
    },
    [props.onSessionChange],
  );
  const [rows, setRows] = useState<ChatRow[]>([]);

  const {
    value,
    setValue,
    inputRevision,
    setInputRevision,
    inputHistory,
    setInputHistory,
    inputHistoryIndex,
    setInputHistoryIndex,
    inputHistoryDraft,
    setInputHistoryDraft,
    applyingHistoryRef,
  } = useInputState(currentSession.messages);

  const {
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
  } = usePendingState();

  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsageEntry[]>(() => session.tokenUsage ?? []);

  useSyncEffect(() => {
    setTokenUsage(currentSession.tokenUsage ?? []);
  }, [currentSession]);

  const {
    slashSuggestions,
    slashSuggestionIndex,
    setSlashSuggestionIndex,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    setAtSuggestionIndex,
  } = useSuggestions(value);

  const [showHelp, setShowHelp] = useState(false);
  const cursorLineRef = useRef(0);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  const { promotedRows, promote, clearTranscript } = usePromotion({
    version: props.version,
    session,
    currentSessionId: currentSession.id,
    setRows,
  });

  const interruptRef = useRef<(() => void) | null>(null);
  const handleSubmitRef = useRef<((text: string) => Promise<void>) | null>(null);

  const workspace = shownCwd();
  const footerContext = `${workspace} · ${branch ?? "—"} · ${formatModel(currentSession.model, appConfig.reasoning)}`;

  useMountEffect(() => {
    loadSkills().catch(() => {});
  });

  useAsyncEffect(async (cancelled) => {
    try {
      const result = await shownBranch();
      if (!cancelled()) setBranch(result);
    } catch {
      if (!cancelled()) setBranch(null);
    }
  }, []);

  const activateSkill = createSkillActivator(
    {},
    {
      currentSession,
      setRows,
      nowIso,
      persist,
    },
  );

  const { openSkillsPanel, openResumePanel, openModelPanel, handlePickerSelect } = createPickerHandlers({
    sessionState,
    currentSession,
    setCurrentSession: updateSession,
    setTokenUsage,
    setRows,
    setRowsDirect: setRows,
    setPicker,
    setShowHelp,
    setValue,
    persist,
    toRows,
    nowIso,
    activateSkill,
    startAssistantTurn: (userText) => startAssistantTurn(userText),
    clearTranscript,
  });

  const { handleSubmit, startAssistantTurn } = createMessageHandler({
    client,
    sessionState,
    currentSession,
    setCurrentSession: updateSession,
    toRows,
    setRows,
    setShowHelp,
    setValue,
    persist,
    exit,
    openSkillsPanel,
    activateSkill,
    openResumePanel,
    openModelPanel,
    tokenUsage,
    isPending,
    setInputHistory,
    setInputHistoryIndex,
    setInputHistoryDraft,
    onStartPending: () => setPendingState({ kind: "accepted" }),
    onStopPending: () => {
      setPendingState(null);
      setRunningUsage(null);
      promote();
      setQueuedMessages((current) => {
        if (current.length === 0) return current;
        const [next, ...rest] = current;
        if (next) queueMicrotask(() => void handleSubmitRef.current?.(next));
        return rest;
      });
    },
    setPendingState,
    setRunningUsage,
    setTokenUsage,
    createMessage,
    nowIso,
    setInterrupt: (handler) => {
      interruptRef.current = handler;
    },
    promote,
    clearTranscript,
  });
  handleSubmitRef.current = handleSubmit;

  useChatKeybindings({
    persist,
    exit,
    picker,
    setPicker,
    handlePickerSelect,
    inputHistory,
    inputHistoryIndex,
    inputHistoryDraft,
    value,
    setValue,
    setInputRevision,
    applyingHistoryRef,
    isPending,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    setAtSuggestionIndex,
    slashSuggestions,
    slashSuggestionIndex,
    setSlashSuggestionIndex,
    setInputHistoryIndex,
    setInputHistoryDraft,
    openSkillsPanel,
    showHelp,
    setShowHelp,
    interruptCurrentTurn: () => {
      interruptRef.current?.();
    },
    ctrlCPending,
    setCtrlCPending,
    cursorLineRef,
  });

  const handlePickerQueryChange = useCallback((query: string) => {
    setPicker((current) => {
      if (!current || current.kind !== "model") return current;
      const filtered = suggestModels(query, current.items);
      return { ...current, query, filtered, index: 0, scrollOffset: 0 };
    });
  }, []);

  const handlePickerSubmit = useCallback(() => {
    if (picker && pickerItemCount(picker) > 0) void handlePickerSelect(picker);
  }, [picker, handlePickerSelect]);

  const handleInputChange = useCallback(
    (next: string) => {
      const decision = processInputChange({
        currentValue: value,
        nextValue: next,
        applyingHistory: applyingHistoryRef.current,
      });
      if (decision.ignore) return;
      if (decision.clearApplyingHistory) applyingHistoryRef.current = false;
      if (decision.resetHistoryIndex) setInputHistoryIndex(-1);
      if (showHelp) setShowHelp(false);
      if (ctrlCPending) setCtrlCPending(false);
      setValue(decision.nextValue);
    },
    [value, setValue, setInputHistoryIndex, applyingHistoryRef, showHelp, ctrlCPending, setCtrlCPending],
  );

  const handleInputSubmit = useCallback(
    (next: string) => {
      const resolved = processInputSubmit({
        value: next,
        atSuggestions,
        atSuggestionIndex,
        slashSuggestions,
        slashSuggestionIndex,
      });
      log.debug("chat.submit", {
        value: next,
        suggestions: slashSuggestions.join(","),
        resolved: resolved.kind,
      });
      if (resolved.kind === "autocomplete") {
        setValue(resolved.value);
        setInputRevision((current) => current + 1);
        return;
      }
      const queueDecision = resolveQueueSubmit({ value: resolved.value, isPending });
      if (queueDecision.kind === "ignore") return;
      if (isPending) {
        setQueuedMessages((current) => enqueueQueuedMessage(current, queueDecision.value, QUEUE_DELIVERY_POLICY));
        setValue("");
        return;
      }
      void handleSubmit(queueDecision.value);
    },
    [
      atSuggestions,
      atSuggestionIndex,
      slashSuggestions,
      slashSuggestionIndex,
      isPending,
      setQueuedMessages,
      setValue,
      setInputRevision,
      handleSubmit,
    ],
  );

  return {
    promotedRows,
    rows,
    pendingState,
    pendingFrame,
    pendingStartedAt,
    queuedMessages,
    runningUsage,
    picker,
    value,
    inputRevision,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    slashSuggestions,
    slashSuggestionIndex,
    showHelp,
    ctrlCPending,
    activeSessionId: sessionState.activeSessionId,
    footerContext,
    handleInputChange,
    handleInputSubmit,
    handlePickerQueryChange,
    handlePickerSubmit,
    onCursorLine: (line: number) => {
      cursorLineRef.current = line;
    },
  };
}
