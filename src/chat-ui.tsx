import { homedir } from "node:os";
import React, { useState } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Backend } from "./backend";
import { listMemories } from "./memory";
import { listSkills, readSkillInstructions } from "./skills";
import { createSession } from "./storage";
import type { Message, Session, SessionStore } from "./types";
import type { SkillMeta } from "./skills";

type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

type HeaderLine = {
  id: string;
  text: string;
  suffix?: string;
  dim: boolean;
  brand: boolean;
};

const TOOL_LABELS = ["Run", "Search", "Read", "Diff", "Edit", "Update", "Status"] as const;
const BRAND_COLOR = "#A56EFF";
const MAX_SKILL_INSTRUCTION_CHARS = 4000;

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

export function sanitizeAssistantContent(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^\s*(Tools used:|Evidence:)/.test(line))
    .join("\n")
    .trimEnd();
}

export type ResumeResolution =
  | { kind: "usage" }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] }
  | { kind: "ok"; session: Session };

export function resolveResumeSession(store: SessionStore, text: string): ResumeResolution {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length < 2) {
    return { kind: "usage" };
  }
  const prefix = parts[1];
  const matches = store.sessions.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0) {
    return { kind: "not_found", prefix };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", prefix, matches };
  }
  return { kind: "ok", session: matches[0] };
}

export function formatSessionList(store: SessionStore, limit = 10): string[] {
  return store.sessions.slice(0, limit).map((item) => {
    const active = item.id === store.activeSessionId ? "*" : " ";
    const title = item.title || "New Session";
    return `${active} ${item.id.slice(0, 12)}  ${title}`;
  });
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

function truncateText(input: string, max = 72): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

function ChatApp(props: ChatAppProps) {
  const { backend, session, store, persist, version } = props;
  const { exit } = useApp();
  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [value, setValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const [skillsPanelItems, setSkillsPanelItems] = useState<SkillMeta[]>([]);
  const [skillsPanelIndex, setSkillsPanelIndex] = useState(0);
  const headerLines: HeaderLine[] = [
    { id: "title", text: "Acolyte", suffix: ` v${version}`, dim: false, brand: true },
    {
      id: "session",
      text: `${currentSession.model} · session ${currentSession.id.slice(0, 12)}`,
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
      if (skillsPanelOpen) {
        if (key.escape) {
          setSkillsPanelOpen(false);
          return;
        }
        if (key.upArrow || input === "k") {
          setSkillsPanelIndex((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow || input === "j") {
          setSkillsPanelIndex((current) => Math.min(skillsPanelItems.length - 1, current + 1));
          return;
        }
        if (key.return && skillsPanelItems.length > 0) {
          const selected = skillsPanelItems[skillsPanelIndex];
          if (selected) {
            void (async () => {
              try {
                const instructions = await readSkillInstructions(selected.path);
                const boundedInstructions =
                  instructions.length > MAX_SKILL_INSTRUCTION_CHARS
                    ? `${instructions.slice(0, MAX_SKILL_INSTRUCTION_CHARS - 1)}…`
                    : instructions;
                const msg = newMessage(
                  "system",
                  `Active skill (${selected.name}):\n${boundedInstructions}`,
                );
                currentSession.messages.push(msg);
                currentSession.updatedAt = nowIso();
                setRows((current) => [
                  ...current,
                  {
                    id: `row_${crypto.randomUUID()}`,
                    role: "system",
                    content: `Activated skill: ${selected.name}`,
                  },
                ]);
                await persist();
              } catch {
                setRows((current) => [
                  ...current,
                  {
                    id: `row_${crypto.randomUUID()}`,
                    role: "system",
                    content: `Failed to activate skill: ${selected.name}`,
                  },
                ]);
              }
            })();
          }
          setSkillsPanelOpen(false);
          return;
        }
        return;
      }
      if (!isThinking && input === "$" && value.length === 0) {
        void openSkillsPanel();
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

    if (text.startsWith("/resume")) {
      const resolved = resolveResumeSession(store, text);
      if (resolved.kind === "usage") {
        const recent = formatSessionList(store, 6);
        setRows((current) => [
          ...current,
          { id: `row_${crypto.randomUUID()}`, role: "system", content: "Usage: /resume <session-id-prefix>" },
          ...recent.map((line: string) => ({
            id: `row_${crypto.randomUUID()}`,
            role: "system" as const,
            content: line,
          })),
        ]);
        return;
      }
      if (resolved.kind === "not_found") {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: `No session found for prefix: ${resolved.prefix}`,
          },
        ]);
        return;
      }
      if (resolved.kind === "ambiguous") {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: `Ambiguous prefix: ${resolved.prefix}. Matches: ${resolved.matches.map((item: Session) => item.id.slice(0, 12)).join(", ")}`,
          },
        ]);
        return;
      }
      const target = resolved.session;
      store.activeSessionId = target.id;
      setCurrentSession(target);
      setRows(toRows(target.messages));
      setShowShortcuts(false);
      await persist();
      return;
    }

    if (text === "/sessions") {
      const recent = formatSessionList(store, 10);
      setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "system", content: `Sessions (${store.sessions.length})` },
        ...recent.map((line: string) => ({
          id: `row_${crypto.randomUUID()}`,
          role: "system" as const,
          content: line,
        })),
      ]);
      return;
    }

    if (text === "/skills") {
      await openSkillsPanel();
      return;
    }

    if (text === "/new") {
      const next = createSession(currentSession.model);
      store.sessions.unshift(next);
      store.activeSessionId = next.id;
      setCurrentSession(next);
      setRows([]);
      setShowShortcuts(false);
      await persist();
      return;
    }

    if (text === "/exit") {
      await persist();
      exit();
      return;
    }

    if (text.startsWith("/")) {
      if (text === "/skill" || text.startsWith("/skill ")) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: "Unknown command: /skill. Did you mean /skills?",
          },
        ]);
        return;
      }
      const row: ChatRow = {
        id: `row_${crypto.randomUUID()}`,
        role: "system",
        content: `Unknown command: ${text}`,
      };
      setRows((current) => [...current, row]);
      return;
    }

    const userMessage = newMessage("user", text);
    currentSession.messages.push(userMessage);
    if (currentSession.title === "New Session") {
      currentSession.title = text.trim().replace(/\s+/g, " ").slice(0, 60) || "New Session";
    }
    currentSession.updatedAt = nowIso();
    setRows((current) => [...current, { id: userMessage.id, role: "user", content: text }]);
    setIsThinking(true);
    await persist();

    try {
      const historyWithContext = await buildHistoryWithMemoryContext(currentSession.messages);
      const reply = await backend.reply({
        message: text,
        history: historyWithContext,
        model: currentSession.model,
      });

      const assistantMessage = newMessage("assistant", reply.output);
      currentSession.messages.push(assistantMessage);
      currentSession.model = reply.model;
      currentSession.updatedAt = nowIso();
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

  const openSkillsPanel = async (): Promise<void> => {
    const skills = await listSkills();
    if (skills.length === 0) {
      setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "system", content: "No skills found in ./skills." },
      ]);
      return;
    }
    setSkillsPanelItems(skills);
    setSkillsPanelIndex(0);
    setShowShortcuts(false);
    setSkillsPanelOpen(true);
  };

  return (
    <Box flexDirection="column">
      <Static<HeaderLine> items={headerLines}>
        {(line) => (
          <Text key={line.id} dimColor={line.dim} color={line.brand ? BRAND_COLOR : undefined}>
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
              <Text>{row.role === "user" ? "❯ " : row.role === "assistant" ? "• " : "  "}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text>{row.role === "assistant" ? renderAssistantContent(row.content) : row.content}</Text>
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
      {skillsPanelOpen ? (
        <>
          <Text dimColor>{borderLine()}</Text>
          <Text>Skills</Text>
          <Text> </Text>
          {skillsPanelItems.map((skill, index) => {
            const nameWidth = Math.min(
              28,
              Math.max(8, ...skillsPanelItems.map((item) => item.name.length)),
            );
            const selected = index === skillsPanelIndex;
            return (
              <Text key={skill.path}>
                {selected ? "› " : "  "}
                <Text color={selected ? BRAND_COLOR : "white"}>{skill.name.padEnd(nameWidth)}</Text>  {truncateText(skill.description)}
              </Text>
            );
          })}
          <Text> </Text>
          <Text dimColor>Esc to close · Enter to select</Text>
          <Text dimColor>{borderLine()}</Text>
        </>
      ) : (
        <>
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
            <Text dimColor>{"  /new  /sessions  /skills  /resume <id>  /exit"}</Text>
          ) : (
            <Text dimColor>  ? for shortcuts</Text>
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

function renderAssistantContent(content: string): React.ReactNode {
  const cleaned = sanitizeAssistantContent(content);

  for (const label of TOOL_LABELS) {
    if (cleaned.startsWith(`${label} `) || cleaned.startsWith(`${label}(`) || cleaned.startsWith(`${label}:`)) {
      return (
        <>
          <Text bold>{label}</Text>
          {cleaned.slice(label.length)}
        </>
      );
    }
  }

  return cleaned;
}
