import { basename } from "node:path";
import { useCallback, useRef, useState } from "react";
import { appConfig } from "./app-config";
import type { ChatRow } from "./chat-contract";
import { useSuggestions } from "./chat-effects";
import { processInputSubmit } from "./chat-input-handlers";
import { useInputState } from "./chat-input-state";
import { useChatKeybindings } from "./chat-keybindings";
import { type GitStatus, gitStatus, SHORTCUT_ITEMS } from "./chat-layout";
import { createMessageHandler } from "./chat-message-handler";
import { usePendingState } from "./chat-pending";
import { type PickerState, pickerItemCount, reduceModelPickerAction } from "./chat-picker";
import { createPickerHandlers } from "./chat-picker-handlers";
import { resumeActiveTranscript, useScenePromotion } from "./chat-promotion";
import { createMessage } from "./chat-session";
import { createSkillActivator } from "./chat-skill-activator";
import { statusTokenTotals } from "./chat-status-line";
import { drainQueueOnTurnEnd, enqueueQueuedMessage, resolveQueueSubmit } from "./chat-submit";
import { projectActiveTranscript, type TranscriptRow } from "./chat-transcript-contract";
import { createTranscriptPublisher } from "./chat-transcript-publisher";
import type { ChatViewportPresentationInput } from "./chat-viewport-contract";
import { createViewportPickerInput, createViewportSuggestionsInput } from "./chat-viewport-publisher";
import type { Client, PendingState } from "./client-contract";
import { nowIso } from "./datetime";
import type { FooterStatus } from "./footer-status-contract";
import type { PrInfo } from "./gh-contract";
import { ghPrView } from "./gh-ops";
import type { InputEditAction } from "./input-controller";
import { log } from "./log";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { loadSkills } from "./skill-ops";
import { useAsyncEffect, useMountEffect, useSyncEffect } from "./tui/effects";
import type { PromotedSceneSlice } from "./tui/scene-viewport";

const QUEUE_DELIVERY_POLICY = "one-at-a-time" as const;

/** Debounce for the git-status refresh; coalesces rapid pending-state churn. */
const GIT_REFRESH_DEBOUNCE_MS = 300;

export interface ChatAppProps {
  client: Client;
  session: Session;
  sessionState: SessionState;
  persist: () => Promise<void>;
  onSessionChange?: (next: Session) => void;
  version: string;
}

export interface ChatStateResult {
  promotedSlices: PromotedSceneSlice[];
  commitPromotion: (slices: readonly PromotedSceneSlice[], committedRowIds: readonly string[]) => void;
  rows: ChatRow[];
  transcriptPresentation: TranscriptRow[];
  activeTranscript: TranscriptRow[];
  presentationInput: ChatViewportPresentationInput;
  pendingState: PendingState | null;
  pendingFrame: number;
  pendingStartedAt: number | null;
  queuedMessages: string[];
  runningUsage: { inputTokens: number; outputTokens: number } | null;
  picker: PickerState | null;
  value: string;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showHelp: boolean;
  ctrlCPending: boolean;
  activeSessionId: string | undefined;
  statusLine: FooterStatus;
  cursor: number;
  handleInputAction: (action: InputEditAction, fromPaste: boolean) => void;
  handleInputSubmit: (next: string) => void;
  handlePickerAction: (action: InputEditAction, fromPaste: boolean) => void;
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
  const [transcript, setTranscript] = useState<{ rows: ChatRow[]; presentation: TranscriptRow[] }>(() =>
    resumeActiveTranscript(session),
  );
  const setRows = useCallback((updater: (current: ChatRow[]) => ChatRow[]) => {
    setTranscript((current) => ({ ...current, rows: updater(current.rows) }));
  }, []);
  const setTranscriptPresentation = useCallback((updater: (current: TranscriptRow[]) => TranscriptRow[]) => {
    setTranscript((current) => ({ ...current, presentation: updater(current.presentation) }));
  }, []);
  const publishRows = useCallback(createTranscriptPublisher({ setTranscript }), []);
  const { rows, presentation: transcriptPresentation } = transcript;

  const {
    input,
    dispatch,
    value,
    setValue,
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
  const activeTranscript = projectActiveTranscript(rows, transcriptPresentation);

  // Presentation is reset explicitly by resume/clear (which also open a new scrollback
  // segment); resetting it here would clobber their freshly-id'd seed on the same
  // currentSession change and desync it from the active rows.
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
  } = useSuggestions(value, input.cursor);

  const [showHelp, setShowHelp] = useState(false);
  const cursorLineRef = useRef(0);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [pr, setPr] = useState<PrInfo | null>(null);

  const { promotedSlices, appendSlices, openSegment } = useScenePromotion({ version: props.version, session });

  // Freeze the newly-scrolled-off slices and evict their rows from the active scene in one
  // commit, so no frame renders a row in both scrollback and the live tail.
  const commitPromotion = useCallback(
    (slices: readonly PromotedSceneSlice[], committedRowIds: readonly string[]) => {
      appendSlices(slices);
      if (committedRowIds.length === 0) return;
      const committed = new Set(committedRowIds);
      setRows((current) => current.filter((row) => !committed.has(row.id)));
    },
    [appendSlices, setRows],
  );

  const clearTranscript = useCallback(
    (sessionId?: string) => {
      openSegment(sessionId ?? currentSession.id);
      setTranscript({ rows: [], presentation: [] });
    },
    [openSegment, currentSession.id],
  );

  const resumeTranscript = useCallback(
    (target: Session) => {
      openSegment(target.id);
      setTranscript(resumeActiveTranscript(target, true));
    },
    [openSegment],
  );

  // The semantic transcript is the single persisted display source; keep it synced to the
  // current session so a resumed session re-lays-out byte-exactly what streamed. Disk
  // persistence is owned by the handler's turn-boundary persist() and the exit persist.
  useSyncEffect(() => {
    currentSession.transcriptPresentation = transcriptPresentation;
  }, [currentSession, transcriptPresentation]);

  const interruptRef = useRef<(() => void) | null>(null);
  const handleSubmitRef = useRef<((text: string) => Promise<void>) | null>(null);
  const queuedMessagesRef = useRef<string[]>([]);
  queuedMessagesRef.current = queuedMessages;

  const tokenTotals = statusTokenTotals(tokenUsage, runningUsage);
  const statusLine: FooterStatus = {
    repo: git?.repo ?? basename(process.cwd()),
    worktree: git?.worktree ?? null,
    branch: git?.branch ?? null,
    dirty: git?.dirty ?? false,
    ahead: git?.ahead ?? 0,
    behind: git?.behind ?? 0,
    model: formatModel(currentSession.model),
    effort: appConfig.reasoning ?? null,
    inputTokens: tokenTotals.inputTokens,
    outputTokens: tokenTotals.outputTokens,
    pr,
    skills: currentSession.activeSkills?.map((s) => s.name) ?? [],
  };
  const presentationInput: ChatViewportPresentationInput = {
    header: { title: "Acolyte", version: props.version, sessionId: currentSession.id },
    activeTranscript,
    pending: pendingState
      ? {
          state: pendingState,
          frame: pendingFrame,
          startedAt: pendingStartedAt,
          queuedMessages,
          runningUsage,
        }
      : null,
    composer: {
      input,
      picker: createViewportPickerInput(picker, currentSession.id),
      suggestions: createViewportSuggestionsInput({
        atQuery,
        atSuggestions,
        atSuggestionIndex,
        slashSuggestions,
        slashSuggestionIndex,
      }),
      help: { visible: showHelp, entries: SHORTCUT_ITEMS },
      ctrlCPending,
      footer: statusLine,
    },
  };

  useMountEffect(() => {
    loadSkills().catch(() => {});
  });

  // PR state can change mid-session (the agent may open one), but `gh` is a
  // network call, so refresh it only at turn boundaries — never on the per-tool
  // churn that drives the git refresh below. Runs on mount and each turn end.
  useAsyncEffect(
    async (cancelled) => {
      if (pendingState !== null) return;
      try {
        const prResult = await ghPrView(process.cwd());
        if (!cancelled()) setPr(prResult);
      } catch {
        if (!cancelled()) setPr(null);
      }
    },
    [pendingState === null],
  );

  // Git status is fast and local, so refresh it on every pending-state
  // transition — tool-call churn included, so a mid-turn commit surfaces within
  // a debounce window. The sleep coalesces rapid transitions: each new one
  // cancels the prior effect's timer and in-flight fetch (useAsyncEffect's
  // cleanup), mirroring Claude Code's debounce + abort. Keep the last-known-good
  // status on a transient failure so the segment never flickers away.
  useAsyncEffect(
    async (cancelled) => {
      await Bun.sleep(GIT_REFRESH_DEBOUNCE_MS);
      if (cancelled()) return;
      const result = await gitStatus();
      if (!cancelled()) setGit((previous) => result ?? previous);
    },
    [pendingState],
  );

  const activateSkill = createSkillActivator({
    currentSession,
    setRows: publishRows,
    nowIso,
    persist,
  });

  const { openSkillsPanel, openResumePanel, openModelPanel, handlePickerSelect } = createPickerHandlers({
    sessionState,
    currentSession,
    setCurrentSession: updateSession,
    setTokenUsage,
    setRows: publishRows,
    setPicker,
    setShowHelp,
    setValue,
    persist,
    nowIso,
    activateSkill,
    startAssistantTurn: (userText) => startAssistantTurn(userText),
    resumeTranscript,
    clearTranscript,
  });

  const { handleSubmit, startAssistantTurn } = createMessageHandler({
    client,
    sessionState,
    currentSession,
    setCurrentSession: updateSession,
    setRows: publishRows,
    setTranscriptPresentation,
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
      drainQueueOnTurnEnd({
        queue: queuedMessagesRef.current,
        submit: (message) => queueMicrotask(() => void handleSubmitRef.current?.(message)),
        setQueue: setQueuedMessages,
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
    resumeTranscript,
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
    applyingHistoryRef,
    isPending,
    cursor: input.cursor,
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

  const handlePickerAction = useCallback((action: InputEditAction, _fromPaste: boolean) => {
    setPicker((current) => (current?.kind === "model" ? reduceModelPickerAction(current, action) : current));
  }, []);

  const handlePickerSubmit = useCallback(() => {
    if (picker && pickerItemCount(picker) > 0) void handlePickerSelect(picker);
  }, [picker, handlePickerSelect]);

  const handleInputAction = useCallback(
    (action: InputEditAction, _fromPaste: boolean) => {
      const textChanging =
        action.kind === "insert" ||
        action.kind === "delete-backward" ||
        action.kind === "delete-forward" ||
        action.kind === "delete-word-backward" ||
        action.kind === "clear" ||
        action.kind === "replace";
      if (textChanging) {
        if (applyingHistoryRef.current) applyingHistoryRef.current = false;
        else setInputHistoryIndex(-1);
        if (showHelp) setShowHelp(false);
        if (ctrlCPending) setCtrlCPending(false);
      }
      dispatch(action);
    },
    [dispatch, setInputHistoryIndex, applyingHistoryRef, showHelp, ctrlCPending, setCtrlCPending],
  );

  const handleInputSubmit = useCallback(
    (next: string) => {
      const resolved = processInputSubmit({
        value: next,
        cursor: input.cursor,
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
      input.cursor,
      atSuggestions,
      atSuggestionIndex,
      slashSuggestions,
      slashSuggestionIndex,
      isPending,
      setQueuedMessages,
      setValue,
      handleSubmit,
    ],
  );

  return {
    promotedSlices,
    commitPromotion,
    rows,
    transcriptPresentation,
    activeTranscript,
    presentationInput,
    pendingState,
    pendingFrame,
    pendingStartedAt,
    queuedMessages,
    runningUsage,
    picker,
    value,
    cursor: input.cursor,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    slashSuggestions,
    slashSuggestionIndex,
    showHelp,
    ctrlCPending,
    activeSessionId: sessionState.activeSessionId,
    statusLine,
    handleInputAction,
    handleInputSubmit,
    handlePickerAction,
    handlePickerSubmit,
    onCursorLine: (line: number) => {
      cursorLineRef.current = line;
    },
  };
}
