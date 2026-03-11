import { Box, render, Text, useApp } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ChatRow } from "./chat-commands";
import { useAtSuggestionsEffect, useSlashSuggestionsEffect, useThinkingAnimationEffect } from "./chat-effects";
import { extractAtReferenceQuery } from "./chat-file-ref";
import type { HeaderLine } from "./chat-header";
import { ChatHeader } from "./chat-header";
import { processInputChange, processInputSubmit } from "./chat-input-handlers";
import { ChatInputPanel } from "./chat-input-panel";
import { useChatKeybindings } from "./chat-keybindings";
import { shownBranch, shownCwd } from "./chat-layout";
import { createMessageHandler } from "./chat-message-handler";
import type { PickerState } from "./chat-picker";
import { createPickerHandlers } from "./chat-picker-handlers";
import { createMessage, toRows } from "./chat-session";
import { suggestSlashCommands } from "./chat-slash";
import { enqueueQueuedMessage, resolveQueueSubmit } from "./chat-submit";
import { ChatTranscript } from "./chat-transcript";
import { createInputHistory } from "./chat-turn";
import type { Client } from "./client-contract";
import { nowIso } from "./datetime";
import { palette } from "./palette";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { loadSkills } from "./skills";

const THINKING_PULSE_FRAMES = 16;
const QUEUE_DELIVERY_POLICY = "one-at-a-time" as const;

interface ChatAppProps {
  client: Client;
  session: Session;
  store: SessionState;
  persist: () => Promise<void>;
  version: string;
  useMemory?: boolean;
}

export function initialTranscriptRows(session: Session): ChatRow[] {
  return toRows(session.messages);
}

function ChatApp(props: ChatAppProps) {
  const { client, session, store, persist, version, useMemory } = props;
  const { exit } = useApp();
  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [rows, setRows] = useState<ChatRow[]>(() => initialTranscriptRows(session));
  const [value, setValue] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [isWorking, setIsWorking] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsageEntry[]>(() => session.tokenUsage ?? []);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [inputHistoryIndex, setInputHistoryIndex] = useState(-1);
  const [inputHistoryDraft, setInputHistoryDraft] = useState("");
  const applyingHistoryRef = useRef(false);
  const slashSuggestions = suggestSlashCommands(value);
  const [slashSuggestionIndex, setSlashSuggestionIndex] = useState(0);
  const atQuery = extractAtReferenceQuery(value);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atSuggestionIndex, setAtSuggestionIndex] = useState(0);
  const interruptRef = useRef<(() => void) | null>(null);
  const workspace = shownCwd();
  const headerLines: HeaderLine[] = [
    { id: "title", text: "Acolyte", suffix: "", dim: false, brand: true },
    {
      id: "session",
      text: `version ${version}`,
      dim: false,
      brand: false,
    },
    {
      id: "context",
      text: `session ${currentSession.id}`,
      dim: true,
      brand: false,
    },
  ];

  useAtSuggestionsEffect(atQuery, setAtSuggestions, setAtSuggestionIndex);
  useSlashSuggestionsEffect(slashSuggestions, setSlashSuggestionIndex);
  useThinkingAnimationEffect(isWorking, THINKING_PULSE_FRAMES, setThinkingFrame);
  useEffect(() => {
    if (isWorking) {
      setThinkingStartedAt((current) => current ?? Date.now());
      return;
    }
    setThinkingStartedAt(null);
  }, [isWorking]);

  useEffect(() => {
    setInputHistory(createInputHistory(currentSession.messages));
    setInputHistoryIndex(-1);
    setInputHistoryDraft("");
  }, [currentSession.messages]);

  useEffect(() => {
    setTokenUsage(currentSession.tokenUsage ?? []);
  }, [currentSession]);

  useEffect(() => {
    loadSkills().catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    shownBranch()
      .then((value) => {
        if (!cancelled) setBranch(value);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { openSkillsPanel, openResumePanel, openModelPanel, handlePickerSelect, activateSkill } = createPickerHandlers({
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
    createMessage: createMessage,
    nowIso,
  });

  const handleSubmit = createMessageHandler({
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
    isWorking,
    setInputHistory,
    setInputHistoryIndex,
    setInputHistoryDraft,
    startWorking: () => setIsWorking(true),
    stopWorking: () => setIsWorking(false),
    setProgressText,
    setTokenUsage,
    createMessage: createMessage,
    nowIso,
    setInterrupt: (handler) => {
      interruptRef.current = handler;
    },
    useMemory,
  });
  useEffect(() => {
    if (isWorking || queuedMessages.length === 0) return;
    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    if (next) void handleSubmit(next);
  }, [handleSubmit, isWorking, queuedMessages]);

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
    isWorking,
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
  });

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <ChatHeader
        lines={headerLines}
        brandColor={palette.brand}
        mascot={palette.mascot}
        mascotEyes={palette.mascotEyes}
      />
      <ChatTranscript
        rows={rows}
        isWorking={isWorking}
        progressText={progressText}
        thinkingFrame={thinkingFrame}
        thinkingStartedAt={thinkingStartedAt}
        queuedMessages={queuedMessages}
      />

      <Text> </Text>
      <ChatInputPanel
        picker={picker}
        activeSessionId={store.activeSessionId}
        brandColor={palette.brand}
        footerContext={`${workspace} · ${branch ?? "—"} · ${formatModel(currentSession.model)}`}
        value={value}
        inputRevision={inputRevision}
        onChange={(next) => {
          const decision = processInputChange({
            currentValue: value,
            nextValue: next,
            applyingHistory: applyingHistoryRef.current,
          });
          if (decision.ignore) return;
          if (decision.clearApplyingHistory) applyingHistoryRef.current = false;
          if (decision.resetHistoryIndex) setInputHistoryIndex(-1);
          setValue(decision.nextValue);
        }}
        onSubmit={(next) => {
          const resolved = processInputSubmit({
            value: next,
            atSuggestions,
            atSuggestionIndex,
            slashSuggestions,
            slashSuggestionIndex,
          });
          if (resolved.kind === "autocomplete") {
            setValue(resolved.value);
            setInputRevision((current) => current + 1);
            return;
          }
          const queueDecision = resolveQueueSubmit({ value: resolved.value, isWorking });
          if (queueDecision.kind === "ignore") return;
          if (isWorking) {
            setQueuedMessages((current) => enqueueQueuedMessage(current, queueDecision.value, QUEUE_DELIVERY_POLICY));
            setValue("");
            return;
          }
          void handleSubmit(queueDecision.value);
        }}
        atQuery={atQuery}
        atSuggestions={atSuggestions}
        atSuggestionIndex={atSuggestionIndex}
        slashSuggestions={slashSuggestions}
        slashSuggestionIndex={slashSuggestionIndex}
        showHelp={showHelp}
      />
    </Box>
  );
}

export async function runInkChat(props: ChatAppProps): Promise<void> {
  const app = render(<ChatApp {...props} />);
  await app.waitUntilExit();
}
