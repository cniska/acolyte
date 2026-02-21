import { Box, render, Text, useApp } from "ink";
import React, { useEffect, useRef, useState } from "react";
import type { Backend } from "./backend";
import { type ChatRow, type TokenUsageEntry } from "./chat-commands";
import { useAtSuggestionsEffect, useSlashSuggestionsEffect, useThinkingAnimationEffect } from "./chat-effects";
import { extractAtReferenceQuery } from "./chat-file-ref";
import { ChatHeader } from "./chat-header";
import { processInputChange, processInputSubmit } from "./chat-input-handlers";
import { ChatInputPanel } from "./chat-input-panel";
import { useChatKeybindings } from "./chat-keybindings";
import { shownCwd } from "./chat-layout";
import { type PickerState } from "./chat-picker";
import { createPickerHandlers } from "./chat-picker-handlers";
import { newMessage, nowIso, toRows } from "./chat-session";
import { suggestSlashCommands } from "./chat-slash";
import { resolveQueueSubmit } from "./chat-submit";
import { createSubmitHandler } from "./chat-submit-handler";
import { ChatTranscript } from "./chat-transcript";
import type { Session, SessionStore } from "./types";

type HeaderLine = {
  id: string;
  text: string;
  suffix?: string;
  dim: boolean;
  brand: boolean;
};

const COLORS = {
  brand: "#A56EFF",
} as const;
const THINKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface ChatAppProps {
  backend: Backend;
  session: Session;
  store: SessionStore;
  persist: () => Promise<void>;
  version: string;
}

function ChatApp(props: ChatAppProps) {
  const { backend, session, store, persist, version } = props;
  const { exit } = useApp();
  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [value, setValue] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [queuedInput, setQueuedInput] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageEntry[]>([]);
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
  const headerLines: HeaderLine[] = [
    { id: "title", text: "Acolyte", suffix: ` v${version}`, dim: false, brand: true },
    {
      id: "session",
      text: `${currentSession.model} · session ${currentSession.id.slice(0, 12)}`,
      dim: false,
      brand: false,
    },
    { id: "cwd", text: shownCwd(), dim: true, brand: false },
  ];

  useAtSuggestionsEffect(atQuery, setAtSuggestions, setAtSuggestionIndex);
  useSlashSuggestionsEffect(slashSuggestions, setSlashSuggestionIndex);
  useThinkingAnimationEffect(isThinking, THINKING_FRAMES.length, setThinkingFrame);

  const { openSkillsPanel, openResumePanel, handlePickerSelect } = createPickerHandlers({
    store,
    currentSession,
    setCurrentSession,
    setRows,
    setRowsDirect: setRows,
    setPicker: (next) => setPicker(next),
    setShowShortcuts,
    persist,
    toRows,
    createMessage: newMessage,
    nowIso,
  });

  const handleSubmit = createSubmitHandler({
    backend,
    store,
    currentSession,
    setCurrentSession,
    toRows,
    setRows,
    setShowShortcuts,
    setValue,
    persist,
    exit,
    openSkillsPanel,
    openResumePanel,
    tokenUsage,
    isThinking,
    setInputHistory,
    setInputHistoryIndex,
    setInputHistoryDraft,
    setIsThinking,
    setTokenUsage,
    createMessage: newMessage,
    nowIso,
    setInterrupt: (handler) => {
      interruptRef.current = handler;
    },
  });
  useEffect(() => {
    if (isThinking || !queuedInput) {
      return;
    }
    const next = queuedInput;
    setQueuedInput(null);
    void handleSubmit(next);
  }, [handleSubmit, isThinking, queuedInput]);

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
    isThinking,
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
    showShortcuts,
    setShowShortcuts,
    interruptCurrentTurn: () => {
      interruptRef.current?.();
    },
  });

  return (
    <Box flexDirection="column">
      <ChatHeader lines={headerLines} brandColor={COLORS.brand} />
      <ChatTranscript rows={rows} isThinking={isThinking} thinkingFrame={THINKING_FRAMES[thinkingFrame] ?? "⠋"} />

      <Text> </Text>
      <ChatInputPanel
        picker={picker}
        activeSessionId={store.activeSessionId}
        brandColor={COLORS.brand}
        value={value}
        inputRevision={inputRevision}
        onChange={(next) => {
          const decision = processInputChange({
            currentValue: value,
            nextValue: next,
            applyingHistory: applyingHistoryRef.current,
          });
          if (decision.ignore) {
            return;
          }
          if (decision.clearApplyingHistory) {
            applyingHistoryRef.current = false;
          }
          if (decision.resetHistoryIndex) {
            setInputHistoryIndex(-1);
          }
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
          const queueDecision = resolveQueueSubmit({ value: resolved.value, isThinking });
          if (queueDecision.kind === "ignore") {
            return;
          }
          if (queueDecision.kind === "queue") {
            setQueuedInput(queueDecision.value);
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
        showShortcuts={showShortcuts}
        queuedInput={queuedInput}
      />
    </Box>
  );
}

export async function runInkChat(props: ChatAppProps): Promise<void> {
  const useAltScreen = Boolean(process.stdout.isTTY);
  if (useAltScreen) {
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
  }

  const app = render(<ChatApp {...props} />);
  try {
    await app.waitUntilExit();
  } finally {
    if (useAltScreen) {
      process.stdout.write("\x1b[?1049l");
    }
  }
}
