import { useCallback, useRef, useState } from "react";
import type { ChatRow } from "./chat-contract";
import { clampSuggestionIndex, useAtSuggestionsEffect, useThinkingAnimationEffect } from "./chat-effects";
import { extractAtReferenceQuery } from "./chat-file-ref";
import { appendGraduatedItems, createHeaderItem, type GraduatedItem, initialTranscriptRows } from "./chat-graduation";
import { processInputChange, processInputSubmit } from "./chat-input-handlers";
import { useChatKeybindings } from "./chat-keybindings";
import { shownBranch, shownCwd } from "./chat-layout";
import { createMessageHandler } from "./chat-message-handler";
import { suggestModels } from "./chat-model-autocomplete";
import { type PickerState, pickerItemCount } from "./chat-picker";
import { createPickerHandlers } from "./chat-picker-handlers";
import { createMessage, toRows } from "./chat-session";
import { createSkillActivator } from "./chat-skill-activator";
import { suggestSlashCommands } from "./chat-slash";
import { enqueueQueuedMessage, resolveQueueSubmit } from "./chat-submit";
import { createInputHistory } from "./chat-turn";
import type { Client, PendingState } from "./client-contract";
import { nowIso } from "./datetime";
import { log } from "./log";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { loadSkills } from "./skills";
import { useAsyncEffect, useMountEffect, useSyncEffect } from "./tui/effects";
import { clearScreen } from "./ui";

const THINKING_PULSE_FRAMES = 16;
const QUEUE_DELIVERY_POLICY = "one-at-a-time" as const;

export interface ChatAppProps {
  client: Client;
  session: Session;
  store: SessionState;
  persist: () => Promise<void>;
  version: string;
  useMemory?: boolean;
}

export interface ChatStateResult {
  graduatedRows: GraduatedItem[];
  rows: ChatRow[];
  pendingState: PendingState | null;
  thinkingFrame: number;
  thinkingStartedAt: number | null;
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
}

export function useChatState(props: ChatAppProps, exit: () => void): ChatStateResult {
  const { client, session, store, persist, useMemory } = props;

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const [value, setValue] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [inputHistoryIndex, setInputHistoryIndex] = useState(-1);
  const [inputHistoryDraft, setInputHistoryDraft] = useState("");
  const applyingHistoryRef = useRef(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  useSyncEffect(() => {
    setInputHistory(createInputHistory(currentSession.messages));
    setInputHistoryIndex(-1);
    setInputHistoryDraft("");
  }, [currentSession.messages]);

  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const isPending = pendingState !== null;
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  useSyncEffect(() => {
    if (isPending) {
      setThinkingStartedAt((current) => current ?? Date.now());
    } else {
      setThinkingStartedAt(null);
      setThinkingFrame(0);
    }
  }, [isPending]);

  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsageEntry[]>(() => session.tokenUsage ?? []);
  const [runningUsage, setRunningUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);

  useSyncEffect(() => {
    setTokenUsage(currentSession.tokenUsage ?? []);
  }, [currentSession]);

  const slashSuggestions = suggestSlashCommands(value);
  const [slashSuggestionIndex, setSlashSuggestionIndex] = useState(0);
  const atQuery = extractAtReferenceQuery(value);

  useSyncEffect(() => {
    setSlashSuggestionIndex((current) => clampSuggestionIndex(current, slashSuggestions.length));
  }, [slashSuggestions]);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atSuggestionIndex, setAtSuggestionIndex] = useState(0);

  const [showHelp, setShowHelp] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  const [graduatedRows, setGraduatedRows] = useState<GraduatedItem[]>(() => [
    createHeaderItem(props.version, session.id),
    ...initialTranscriptRows(session),
  ]);

  const interruptRef = useRef<(() => void) | null>(null);

  const workspace = shownCwd();
  const footerContext = `${workspace} · ${branch ?? "—"} · ${formatModel(currentSession.model)}`;

  const graduate = useCallback(() => {
    const current = rowsRef.current;
    log.debug("chat.graduate.trigger", { rows: current.length });
    if (current.length === 0) return;
    const graduatedIds = new Set(current.map((row) => row.id));
    setGraduatedRows((prev) => appendGraduatedItems(prev, current));
    setRows((live) => {
      const surviving = live.filter((row) => !graduatedIds.has(row.id));
      log.debug("chat.graduate.done", { graduated: graduatedIds.size, surviving: surviving.length });
      return surviving;
    });
  }, []);

  const clearTranscript = useCallback(
    (sessionId?: string) => {
      clearScreen();
      setGraduatedRows((prev) => [...prev, createHeaderItem(props.version, sessionId ?? currentSession.id)]);
      setRows([]);
    },
    [props.version, currentSession.id],
  );

  useMountEffect(() => {
    loadSkills().catch(() => {});
  });

  useAsyncEffect(async (cancelled) => {
    try {
      const value = await shownBranch();
      if (!cancelled()) setBranch(value);
    } catch {
      if (!cancelled()) setBranch(null);
    }
  }, []);

  useAtSuggestionsEffect(atQuery, setAtSuggestions, setAtSuggestionIndex);
  useThinkingAnimationEffect(isPending, THINKING_PULSE_FRAMES, setThinkingFrame);

  const activateSkill = createSkillActivator(
    {},
    {
      currentSession,
      setRows,
      createMessage,
      nowIso,
      persist,
    },
  );

  const { openSkillsPanel, openResumePanel, openModelPanel, handlePickerSelect } = createPickerHandlers({
    store,
    currentSession,
    setCurrentSession,
    setTokenUsage,
    setRows,
    setRowsDirect: setRows,
    setPicker: (next) => setPicker(next),
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
    store,
    currentSession,
    setCurrentSession,
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
      graduate();
      setQueuedMessages((current) => {
        if (current.length === 0) return current;
        const [next, ...rest] = current;
        if (next) queueMicrotask(() => void handleSubmit(next));
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
    useMemory,
    graduate,
    clearTranscript,
  });

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
    [value, showHelp, ctrlCPending],
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
      log.debug("chat.submit", { value: next, suggestions: slashSuggestions.join(","), resolved: resolved.kind });
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
    [atSuggestions, atSuggestionIndex, slashSuggestions, slashSuggestionIndex, isPending, handleSubmit],
  );

  return {
    graduatedRows,
    rows,
    pendingState,
    thinkingFrame,
    thinkingStartedAt,
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
    activeSessionId: store.activeSessionId,
    footerContext,
    handleInputChange,
    handleInputSubmit,
    handlePickerQueryChange,
    handlePickerSubmit,
  };
}
