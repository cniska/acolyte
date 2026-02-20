import { Box, render, Static, Text, useApp } from "ink";
import React, { useRef, useState } from "react";
import type { Backend } from "./backend";
import { type ChatRow, type TokenUsageEntry } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";
import { useAtSuggestionsEffect, useSlashSuggestionsEffect, useThinkingAnimationEffect } from "./chat-effects";
import { extractAtReferenceQuery } from "./chat-file-ref";
import { useChatKeybindings } from "./chat-keybindings";
import {
  borderLine,
  formatShortcutRows,
  type PickerState,
  pickerHint,
  pickerTitle,
  renderPickerItems,
  shownCwd,
} from "./chat-layout";
import { createPickerHandlers } from "./chat-picker-handlers";
import { suggestSlashCommands } from "./chat-slash";
import { resolveSubmitInput } from "./chat-submit";
import { createSubmitHandler } from "./chat-submit-handler";
import { PromptInput } from "./prompt-input";
import type { Message, Session, SessionStore } from "./types";

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

function nowIso(): string {
  return new Date().toISOString();
}

function newMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${crypto.randomUUID()}`,
    role,
    content,
    timestamp: nowIso(),
  };
}

const RESUME_TRANSCRIPT_ROWS = 40;

export function toRows(messages: Message[], limit = RESUME_TRANSCRIPT_ROWS): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      rows.push({
        id: message.id,
        role: message.role,
        content: message.content,
      });
    }
  }
  return rows.slice(-limit);
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
  });

  return (
    <Box flexDirection="column">
      <Static<HeaderLine> items={headerLines}>
        {(line) => (
          <Text key={line.id} dimColor={line.dim} color={line.brand ? COLORS.brand : undefined}>
            {line.id === "title" ? (
              <>
                <Text bold>{line.text}</Text>
                <Text dimColor>{line.suffix}</Text>
              </>
            ) : (
              line.text
            )}
          </Text>
        )}
      </Static>

      {rows.map((row, index) => (
        <React.Fragment key={row.id}>
          {index > 0 ? <Text> </Text> : null}
          <Box>
            <Box width={2}>
              <Text dimColor={Boolean(row.dim)}>
                {row.role === "user" ? "❯ " : row.role === "assistant" ? "• " : "  "}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text dimColor={Boolean(row.dim)}>
                {row.role === "assistant" ? renderAssistantContent(row.content) : row.content}
              </Text>
            </Box>
          </Box>
        </React.Fragment>
      ))}
      {isThinking ? (
        <>
          {rows.length > 0 ? <Text> </Text> : null}
          <Text dimColor>{`  ${THINKING_FRAMES[thinkingFrame]} thinking…`}</Text>
        </>
      ) : null}

      <Text> </Text>
      {picker ? (
        <>
          <Text dimColor>{borderLine()}</Text>
          <Text>{pickerTitle(picker)}</Text>
          <Text> </Text>
          {renderPickerItems(picker, store.activeSessionId, COLORS.brand)}
          <Text> </Text>
          <Text dimColor>{pickerHint(picker)}</Text>
          <Text dimColor>{borderLine()}</Text>
        </>
      ) : (
        <>
          <Text dimColor>{borderLine()}</Text>
          <Box>
            <Text>❯ </Text>
            <PromptInput
              value={value}
              placeholder="Ask something…"
              onChange={(next) => {
                if (value.length === 0 && next === "?") {
                  return;
                }
                if (applyingHistoryRef.current) {
                  applyingHistoryRef.current = false;
                } else {
                  setInputHistoryIndex(-1);
                }
                setValue(next);
              }}
              onSubmit={(next) => {
                const resolved = resolveSubmitInput({
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
                void handleSubmit(next);
              }}
              key={`chat-input-${inputRevision}`}
            />
          </Box>
          <Text dimColor>{borderLine()}</Text>

          {atQuery !== null && atSuggestions.length > 0 ? (
            <>
              {atSuggestions.map((item) => (
                <Text
                  key={`at-suggestion-${item}`}
                  color={item === atSuggestions[atSuggestionIndex] ? COLORS.brand : undefined}
                >{`  ${item}`}</Text>
              ))}
            </>
          ) : atQuery !== null ? (
            <Text dimColor> No file or folder matches.</Text>
          ) : slashSuggestions.length > 0 ? (
            <>
              {slashSuggestions.map((item, index) => (
                <Text
                  key={`slash-suggestion-${item}`}
                  color={index === slashSuggestionIndex ? COLORS.brand : undefined}
                  dimColor={index !== slashSuggestionIndex}
                >{`  ${item}`}</Text>
              ))}
            </>
          ) : showShortcuts ? (
            <>
              {formatShortcutRows().map((line, index) => (
                <Text key={`shortcut-row-${index}`} dimColor>
                  {line}
                </Text>
              ))}
            </>
          ) : (
            <Text dimColor> ? for shortcuts</Text>
          )}
        </>
      )}
    </Box>
  );
}

export async function runInkChat(props: ChatAppProps): Promise<void> {
  const app = render(<ChatApp {...props} />);
  await app.waitUntilExit();
}
