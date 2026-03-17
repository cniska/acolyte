import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEntry } from "./chat-contract";
import { useAtSuggestionsEffect, useSlashSuggestionsEffect, useThinkingAnimationEffect } from "./chat-effects";
import { extractAtReferenceQuery } from "./chat-file-ref";
import type { HeaderLine } from "./chat-header";
import { ChatHeader } from "./chat-header";
import { processInputChange, processInputSubmit } from "./chat-input-handlers";
import { ChatInputPanel } from "./chat-input-panel";
import { useChatKeybindings } from "./chat-keybindings";
import { shownBranch, shownCwd } from "./chat-layout";
import { createMessageHandler } from "./chat-message-handler";
import { suggestModels } from "./chat-model-autocomplete";
import { type PickerState, pickerItemCount } from "./chat-picker";
import { createPickerHandlers } from "./chat-picker-handlers";
import { ChatRow } from "./chat-row";
import { createMessage, toRows } from "./chat-session";
import { createSkillActivator } from "./chat-skill-activator";
import { suggestSlashCommands } from "./chat-slash";
import { enqueueQueuedMessage, resolveQueueSubmit } from "./chat-submit";
import { ChatTranscript } from "./chat-transcript";
import { createInputHistory } from "./chat-turn";
import type { Client } from "./client-contract";
import { nowIso } from "./datetime";
import { log } from "./log";
import { palette } from "./palette";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { loadSkills } from "./skills";
import { Box, render, Static, Text, useApp } from "./tui";
import { clearScreen } from "./ui";

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

export function initialTranscriptRows(session: Session): ChatEntry[] {
  return toRows(session.messages);
}

type HeaderItem = { id: string; kind: "header"; lines: HeaderLine[] };
type GraduatedItem = ChatEntry | HeaderItem;

export function appendGraduatedItems(current: GraduatedItem[], next: readonly GraduatedItem[]): GraduatedItem[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((item) => item.id));
  const appended: GraduatedItem[] = [];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    appended.push(item);
  }
  return appended.length > 0 ? [...current, ...appended] : current;
}

export function applyGraduation(
  graduated: GraduatedItem[],
  toGraduate: ChatEntry[],
  live: ChatEntry[],
): { nextGraduated: GraduatedItem[]; nextLive: ChatEntry[] } {
  const graduatedIds = new Set(toGraduate.map((row) => row.id));
  return {
    nextGraduated: appendGraduatedItems(graduated, toGraduate),
    nextLive: live.filter((row) => !graduatedIds.has(row.id)),
  };
}

function isHeaderItem(item: GraduatedItem): item is HeaderItem {
  return "kind" in item && item.kind === "header";
}

function createHeaderItem(version: string, sessionId: string): HeaderItem {
  return {
    id: `header_${sessionId}`,
    kind: "header",
    lines: [
      { id: "title", text: "Acolyte", suffix: "", dim: false, brand: true },
      { id: "session", text: `version ${version}`, dim: false, brand: false },
      { id: "context", text: `session ${sessionId}`, dim: true, brand: false },
    ],
  };
}

function ChatApp(props: ChatAppProps) {
  const { client, session, store, persist, useMemory } = props;
  const { exit } = useApp();
  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [rows, setRows] = useState<ChatEntry[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [value, setValue] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [isWorking, setIsWorking] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsageEntry[]>(() => session.tokenUsage ?? []);
  const [runningUsage, setRunningUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
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

  const [graduatedRows, setGraduatedRows] = useState<GraduatedItem[]>(() => [
    createHeaderItem(props.version, session.id),
    ...initialTranscriptRows(session),
  ]);

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

  // Graduate completed rows when working state ends.
  const prevWorkingRef = useRef(false);
  useEffect(() => {
    if (prevWorkingRef.current && !isWorking) {
      log.debug("chat.graduate.working_end");
      graduate();
    }
    prevWorkingRef.current = isWorking;
  }, [isWorking, graduate]);

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

  const activateSkill = createSkillActivator({
    currentSession,
    setRows,
    createMessage,
    nowIso,
    persist,
  });

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
    isWorking,
    setInputHistory,
    setInputHistoryIndex,
    setInputHistoryDraft,
    startWorking: () => setIsWorking(true),
    stopWorking: () => {
      setIsWorking(false);
      setRunningUsage(null);
    },
    setProgressText,
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
    ctrlCPending,
    setCtrlCPending,
  });

  return (
    <Box flexDirection="column">
      <Static items={graduatedRows}>
        {(item) => {
          if (isHeaderItem(item)) {
            return (
              <Box key={item.id} flexDirection="column">
                <Text> </Text>
                <ChatHeader
                  lines={item.lines}
                  brandColor={palette.brand}
                  mascot={palette.mascot}
                  mascotEyes={palette.mascotEyes}
                />
              </Box>
            );
          }
          const columns = process.stdout.columns ?? 120;
          const contentWidth = Math.max(24, Math.min(120, columns - 2));
          const toolContentWidth = Math.max(24, columns - 2);
          return (
            <Box key={item.id} flexDirection="column">
              <Text> </Text>
              <ChatRow row={item} contentWidth={contentWidth} toolContentWidth={toolContentWidth} />
            </Box>
          );
        }}
      </Static>
      <ChatTranscript
        rows={rows}
        isWorking={isWorking}
        progressText={progressText}
        thinkingFrame={thinkingFrame}
        thinkingStartedAt={thinkingStartedAt}
        queuedMessages={queuedMessages}
        runningUsage={runningUsage}
      />

      <Text> </Text>
      <ChatInputPanel
        picker={picker}
        onPickerQueryChange={(query) => {
          setPicker((current) => {
            if (!current || current.kind !== "model") return current;
            const filtered = suggestModels(query, current.items);
            return { ...current, query, filtered, index: 0, scrollOffset: 0 };
          });
        }}
        onPickerSubmit={() => {
          if (picker && pickerItemCount(picker) > 0) void handlePickerSelect(picker);
        }}
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
          if (showHelp) setShowHelp(false);
          if (ctrlCPending) setCtrlCPending(false);
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
          log.debug("chat.submit", { value: next, suggestions: slashSuggestions.join(","), resolved: resolved.kind });
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
        ctrlCPending={ctrlCPending}
      />
    </Box>
  );
}

export async function runChat(props: ChatAppProps): Promise<void> {
  const app = render(<ChatApp {...props} />);
  await app.waitUntilExit();
}
