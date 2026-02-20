import { homedir } from "node:os";
import React, { useState } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Backend } from "./backend";
import { listMemories } from "./memory";
import type { Message, Session } from "./types";

type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

type HeaderLine = {
  id: string;
  text: string;
  dim: boolean;
  brand: boolean;
};

interface ChatAppProps {
  backend: Backend;
  session: Session;
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

function toRows(messages: Message[]): ChatRow[] {
  void messages;
  return [];
}

function shownCwd(): string {
  const cwd = process.cwd();
  const home = homedir();
  if (cwd === home) {
    return "~";
  }
  if (cwd.startsWith(`${home}/`)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

async function buildHistoryWithMemoryContext(history: Message[]): Promise<Message[]> {
  const memories = await listMemories();
  const top = memories.slice(0, 8);
  if (top.length === 0) {
    return history;
  }

  const memoryLines = top.map((m) => `- ${m.content}`);
  const context: Message = {
    id: `msg_${crypto.randomUUID()}`,
    role: "system",
    content: `User memory context:\n${memoryLines.join("\n")}`,
    timestamp: nowIso(),
  };

  return [context, ...history];
}

function borderLine(): string {
  const width = process.stdout.columns ?? 96;
  return "─".repeat(Math.max(24, width));
}

function ChatApp(props: ChatAppProps) {
  const { backend, session, persist, version } = props;
  const { exit } = useApp();
  const [rows, setRows] = useState<ChatRow[]>(() => toRows(session.messages));
  const [value, setValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const headerLines: HeaderLine[] = [
    { id: "title", text: `Acolyte v${version}`, dim: false, brand: true },
    {
      id: "session",
      text: `${session.model} · session ${session.id.slice(0, 12)}`,
      dim: false,
      brand: false,
    },
    { id: "cwd", text: shownCwd(), dim: true, brand: false },
    { id: "spacer", text: " ", dim: false, brand: false },
  ];

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        void persist().finally(exit);
        return;
      }
      if (!isThinking && input === "?" && value.length === 0) {
        setShowShortcuts((current) => !current);
        return;
      }
      if (key.escape && showShortcuts) {
        setShowShortcuts(false);
      }
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );

  const handleSubmit = async (raw: string): Promise<void> => {
    const text = raw.trim();
    setValue("");
    if (!text || isThinking) {
      return;
    }

    if (text === "?") {
      setShowShortcuts((current) => !current);
      return;
    }

    if (text === "/exit") {
      await persist();
      exit();
      return;
    }

    if (text.startsWith("/")) {
      const row: ChatRow = {
        id: `row_${crypto.randomUUID()}`,
        role: "system",
        content: `Unknown command: ${text}`,
      };
      setRows((current) => [...current, row]);
      return;
    }

    const userMessage = newMessage("user", text);
    session.messages.push(userMessage);
    session.updatedAt = nowIso();
    setRows((current) => [...current, { id: userMessage.id, role: "user", content: text }]);
    setIsThinking(true);
    await persist();

    try {
      const historyWithContext = await buildHistoryWithMemoryContext(session.messages);
      const reply = await backend.reply({
        message: text,
        history: historyWithContext,
        model: session.model,
      });

      const assistantMessage = newMessage("assistant", reply.output);
      session.messages.push(assistantMessage);
      session.model = reply.model;
      session.updatedAt = nowIso();
      setRows((current) => [
        ...current,
        { id: assistantMessage.id, role: "assistant", content: reply.output },
      ]);
      await persist();
    } catch (error) {
      const row: ChatRow = {
        id: `row_${crypto.randomUUID()}`,
        role: "system",
        content: error instanceof Error ? error.message : "Unknown error",
      };
      setRows((current) => [...current, row]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <Box flexDirection="column">
      <Static<HeaderLine> items={headerLines}>
        {(line) => (
          <Text key={line.id} dimColor={line.dim} color={line.brand ? "magentaBright" : undefined}>
            {line.text}
          </Text>
        )}
      </Static>

      {rows.map((row, index) => (
        <React.Fragment key={row.id}>
          {index > 0 ? <Text> </Text> : null}
          <Box>
            <Box width={2}>
              <Text>{row.role === "user" ? "❯ " : row.role === "assistant" ? "• " : "  "}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text>{row.content}</Text>
            </Box>
          </Box>
        </React.Fragment>
      ))}
      {isThinking ? (
        <>
          {rows.length > 0 ? <Text> </Text> : null}
          <Text dimColor>  thinking...</Text>
        </>
      ) : null}

      <Text> </Text>
      <Text dimColor>{borderLine()}</Text>
      <Box>
        <Text>❯ </Text>
        <TextInput
          value={value}
          placeholder="Ask Acolyte..."
          onChange={(next) => {
            if (value.length === 0 && next === "?") {
              return;
            }
            setValue(next);
          }}
          onSubmit={(next) => void handleSubmit(next)}
        />
      </Box>
      <Text dimColor>{borderLine()}</Text>

      {showShortcuts ? (
        <Text dimColor>  /exit quit</Text>
      ) : (
        <Text dimColor>  ? for shortcuts</Text>
      )}
    </Box>
  );
}

export async function runInkChat(props: ChatAppProps): Promise<void> {
  const app = render(<ChatApp {...props} />);
  await app.waitUntilExit();
}
