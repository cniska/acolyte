import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import React, { useRef, useState } from "react";
import { useEffect } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import type { Backend } from "./backend";
import { runShellCommand } from "./coding-tools";
import { buildFileContext } from "./file-context";
import { PromptInput } from "./prompt-input";
import { listSkills, readSkillInstructions } from "./skills";
import { sanitizeAssistantContent, tokenizeForHighlighting } from "./chat-content";
import { formatThoughtDuration, formatVerifySummary } from "./chat-formatters";
import {
  applySlashSuggestion,
  isKnownSlashToken,
  resolveSlashAlias,
  shouldAutocompleteSlashSubmit,
  suggestSlashCommands,
} from "./chat-slash";
import { dispatchSlashCommand, formatSessionList, resolveResumeSession, type TokenUsageEntry } from "./chat-commands";
import type { Message, Session, SessionStore } from "./types";
import type { SkillMeta } from "./skills";
import type { TokenUsage } from "./api";

type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  dim?: boolean;
};

type HeaderLine = {
  id: string;
  text: string;
  suffix?: string;
  dim: boolean;
  brand: boolean;
};

type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number };

const TOOL_LABELS = ["Run", "Search", "Read", "Diff", "Edit", "Update", "Status"] as const;
const COLORS = {
  brand: "#A56EFF",
  highlightCode: "#B7C0CC",
  highlightPath: "#A8B1BC",
} as const;
const MAX_SKILL_INSTRUCTION_CHARS = 4000;
const THINKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SHORTCUT_ITEMS = [
  { key: "@path", description: "attach file/dir context" },
  { key: "/changes", description: "show git changes" },
  { key: "/dogfood <task>", description: "run verify-first coding loop" },
  { key: "/dogfood-status (/ds)", description: "check dogfooding readiness" },
  { key: "/new", description: "new session" },
  { key: "/status", description: "show backend status" },
  { key: "/sessions", description: "list sessions" },
  { key: "/resume <id>", description: "resume session" },
  { key: "/skills", description: "open skills picker" },
  { key: "/remember [--project] <text>", description: "save memory note" },
  { key: "/memory", description: "list memories" },
  { key: "/tokens", description: "show token usage summary" },
  { key: "/exit", description: "exit chat" },
] as const;

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
const MAX_AT_SUGGESTIONS = 8;
const MAX_SCAN_ENTRIES = 5000;
const PATH_CACHE_TTL_MS = 3000;
const IGNORED_DIRS = new Set(["node_modules", ".acolyte", "dist", "build", ".next", "coverage"]);
let repoPathCache:
  | {
      cwd: string;
      loadedAt: number;
      candidates: string[];
    }
  | null = null;

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

type AtToken = {
  query: string;
  start: number;
  end: number;
};

function findActiveAtToken(inputValue: string): AtToken | null {
  const matches = [...inputValue.matchAll(/(^|\s)@([^\s@]*)/g)];
  if (matches.length === 0) {
    return null;
  }
  const match = matches[matches.length - 1];
  const full = match[0] ?? "";
  const query = match[2] ?? "";
  const fullStart = match.index ?? 0;
  const hasLeadingSpace = full.startsWith(" ");
  const start = fullStart + (hasLeadingSpace ? 1 : 0);
  const end = start + full.length - (hasLeadingSpace ? 1 : 0);
  return { query, start, end };
}

export function extractAtReferenceQuery(inputValue: string): string | null {
  return findActiveAtToken(inputValue)?.query ?? null;
}

export function rankAtReferenceSuggestions(paths: string[], query: string, max = MAX_AT_SUGGESTIONS): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return paths.slice(0, max);
  }
  return paths
    .filter((path) => path.toLowerCase().includes(q))
    .sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aStarts = aLower.startsWith(q) ? 0 : 1;
      const bStarts = bLower.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      if (a.length !== b.length) {
        return a.length - b.length;
      }
      return a.localeCompare(b);
    })
    .slice(0, max);
}

export function shouldAutocompleteAtSubmit(
  inputValue: string,
  selectedSuggestion: string | undefined,
): boolean {
  if (!selectedSuggestion) {
    return false;
  }
  const token = findActiveAtToken(inputValue);
  if (!token) {
    return false;
  }
  const currentToken = inputValue.slice(token.start, token.end);
  if (!currentToken.startsWith("@")) {
    return false;
  }
  return currentToken !== `@${selectedSuggestion}`;
}

export function applyAtSuggestion(inputValue: string, suggestion: string): string {
  const token = findActiveAtToken(inputValue);
  if (!token) {
    return inputValue;
  }
  const before = inputValue.slice(0, token.start);
  const after = inputValue.slice(token.end);
  const spacedAfter = after.startsWith(" ") || after.length === 0 ? after : ` ${after}`;
  return `${before}@${suggestion}${spacedAfter}`;
}

export function extractAtReferencePaths(inputValue: string): string[] {
  const matches = [...inputValue.matchAll(/(^|\s)@([^\s@]+)/g)];
  if (matches.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matches) {
    const raw = match[2] ?? "";
    const cleaned = raw.replace(/[.,;:!?]+$/g, "").trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

async function collectRepoPathCandidates(root = process.cwd(), maxEntries = MAX_SCAN_ENTRIES): Promise<string[]> {
  const out: string[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: "" }];

  while (stack.length > 0 && out.length < maxEntries) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const abs = join(current.abs, entry.name);
      if (entry.isDirectory()) {
        if (rel === ".git") {
          out.push(".git/config");
          out.push(".git/COMMIT_EDITMSG");
          continue;
        }
        out.push(`${rel}/`);
        stack.push({ abs, rel });
      } else if (entry.isFile()) {
        out.push(rel);
      }
      if (out.length >= maxEntries) {
        break;
      }
    }
  }

  return out;
}

async function getCachedRepoPathCandidates(root = process.cwd()): Promise<string[]> {
  const now = Date.now();
  if (
    repoPathCache &&
    repoPathCache.cwd === root &&
    now - repoPathCache.loadedAt < PATH_CACHE_TTL_MS
  ) {
    return repoPathCache.candidates;
  }
  const candidates = await collectRepoPathCandidates(root);
  repoPathCache = {
    cwd: root,
    loadedAt: now,
    candidates,
  };
  return candidates;
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

function estimateTokenUsageFallback(prompt: string, output: string): TokenUsage {
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(output.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function formatShortcutRows(): string[] {
  const width = process.stdout.columns ?? 96;
  const columns = width >= 92 ? 2 : 1;
  const rowsPerColumn = Math.ceil(SHORTCUT_ITEMS.length / columns);
  const colWidth = columns > 1 ? Math.floor((width - 2) / columns) : width - 2;
  const keyWidth = 16;
  const lines: string[] = [];

  for (let row = 0; row < rowsPerColumn; row += 1) {
    let line = "  ";
    for (let col = 0; col < columns; col += 1) {
      const index = row + col * rowsPerColumn;
      const item = SHORTCUT_ITEMS[index];
      if (!item) {
        continue;
      }
      const chunk = `${item.key.padEnd(keyWidth)}${item.description}`;
      line += col < columns - 1 ? chunk.padEnd(colWidth) : chunk;
    }
    lines.push(line.trimEnd());
  }

  return lines;
}

function pickerTitle(picker: PickerState): string {
  return picker.kind === "skills" ? "Skills" : "Resume Session";
}

function pickerHint(picker: PickerState): string {
  return picker.kind === "skills" ? "Esc to close · Enter to select" : "Esc to close · Enter to resume";
}

function renderPickerItems(picker: PickerState, activeSessionId: string | undefined): React.ReactNode {
  if (picker.kind === "skills") {
    const nameWidth = Math.min(
      28,
      Math.max(8, ...picker.items.map((item) => item.name.length)),
    );
    return picker.items.map((skill, index) => {
      const selected = index === picker.index;
      return (
        <Text key={skill.path}>
          {selected ? "› " : "  "}
          <Text color={selected ? COLORS.brand : undefined}>
            {skill.name.padEnd(nameWidth)}
          </Text>{" "}
          {truncateText(skill.description)}
        </Text>
      );
    });
  }

  return picker.items.map((item, index) => {
    const selected = index === picker.index;
    const prefix = item.id.slice(0, 12);
    const active = item.id === activeSessionId ? "●" : " ";
    return (
      <Text key={item.id}>
        {selected ? "› " : "  "}
        <Text color={selected ? COLORS.brand : undefined}>{`${active} ${prefix}`}</Text>{" "}
        <Text dimColor>{truncateText(item.title || "New Session")}</Text>
      </Text>
    );
  });
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

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        void persist().finally(exit);
        return;
      }
      if (picker) {
        if (key.escape) {
          setPicker(null);
          return;
        }
        if (key.upArrow || input === "k") {
          setPicker((current) =>
            current ? { ...current, index: Math.max(0, current.index - 1) } : current,
          );
          return;
        }
        if (key.downArrow || input === "j") {
          setPicker((current) =>
            current
              ? { ...current, index: Math.min(current.items.length - 1, current.index + 1) }
              : current,
          );
          return;
        }
        if (key.return && picker.items.length > 0) {
          void handlePickerSelect(picker);
          return;
        }
        return;
      }
      const browsingInputHistory = inputHistoryIndex >= 0;
      const suggestionNavActive =
        !browsingInputHistory && (atQuery !== null || (atQuery === null && slashSuggestions.length > 0));
      if (!isThinking && !suggestionNavActive && key.upArrow) {
        if (inputHistory.length === 0) {
          return;
        }
        if (inputHistoryIndex === -1) {
          setInputHistoryDraft(value);
          const nextIndex = inputHistory.length - 1;
          setInputHistoryIndex(nextIndex);
          applyingHistoryRef.current = true;
          setValue(inputHistory[nextIndex] ?? "");
          setInputRevision((current) => current + 1);
          return;
        }
        const nextIndex = Math.max(0, inputHistoryIndex - 1);
        setInputHistoryIndex(nextIndex);
        applyingHistoryRef.current = true;
        setValue(inputHistory[nextIndex] ?? "");
        setInputRevision((current) => current + 1);
        return;
      }
      if (!isThinking && !suggestionNavActive && key.downArrow && inputHistoryIndex >= 0) {
        if (inputHistoryIndex >= inputHistory.length - 1) {
          setInputHistoryIndex(-1);
          applyingHistoryRef.current = true;
          setValue(inputHistoryDraft);
          setInputRevision((current) => current + 1);
          return;
        }
        const nextIndex = inputHistoryIndex + 1;
        setInputHistoryIndex(nextIndex);
        applyingHistoryRef.current = true;
        setValue(inputHistory[nextIndex] ?? "");
        setInputRevision((current) => current + 1);
        return;
      }
      if (!browsingInputHistory && atQuery !== null && atSuggestions.length > 0) {
        const selected = atSuggestions[Math.max(0, Math.min(atSuggestionIndex, atSuggestions.length - 1))];
        if (key.tab && shouldAutocompleteAtSubmit(value, selected)) {
          setValue(applyAtSuggestion(value, selected ?? ""));
          setInputRevision((current) => current + 1);
          return;
        }
        if (key.upArrow) {
          setAtSuggestionIndex((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow) {
          setAtSuggestionIndex((current) => Math.min(atSuggestions.length - 1, current + 1));
          return;
        }
      }
      if (!browsingInputHistory && atQuery === null && slashSuggestions.length > 0) {
        const selected = slashSuggestions[Math.max(0, Math.min(slashSuggestionIndex, slashSuggestions.length - 1))];
        if (key.tab && shouldAutocompleteSlashSubmit(value, selected)) {
          setValue(applySlashSuggestion(selected ?? ""));
          setInputRevision((current) => current + 1);
          return;
        }
        if (key.upArrow) {
          setSlashSuggestionIndex((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow) {
          setSlashSuggestionIndex((current) => Math.min(slashSuggestions.length - 1, current + 1));
          return;
        }
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

  useEffect(() => {
    let cancelled = false;
    const query = atQuery;
    if (query === null) {
      setAtSuggestions([]);
      setAtSuggestionIndex(0);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const candidates = await getCachedRepoPathCandidates();
      if (cancelled) {
        return;
      }
      const next = rankAtReferenceSuggestions(candidates, query);
      setAtSuggestions(next);
      setAtSuggestionIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
    })();
    return () => {
      cancelled = true;
    };
  }, [atQuery]);

  useEffect(() => {
    setSlashSuggestionIndex((current) => Math.max(0, Math.min(current, Math.max(0, slashSuggestions.length - 1))));
  }, [slashSuggestions]);

  useEffect(() => {
    if (!isThinking) {
      setThinkingFrame(0);
      return;
    }
    const id = setInterval(() => {
      setThinkingFrame((current) => (current + 1) % THINKING_FRAMES.length);
    }, 90);
    return () => {
      clearInterval(id);
    };
  }, [isThinking]);

  const handleSubmit = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || isThinking) {
      return;
    }
    if (text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) {
      return;
    }
    const resolvedText = resolveSlashAlias(text);
    setInputHistory((current) => {
      if (current[current.length - 1] === text) {
        return current;
      }
      const next = [...current, text];
      if (next.length > 200) {
        return next.slice(next.length - 200);
      }
      return next;
    });
    setInputHistoryIndex(-1);
    setInputHistoryDraft("");
    setValue("");

    if (resolvedText === "?") {
      setShowShortcuts((current) => !current);
      return;
    }
    const commandResult = await dispatchSlashCommand({
      text,
      resolvedText,
      backend,
      store,
      currentSession,
      setCurrentSession,
      toRows: (messages) => toRows(messages),
      setRows,
      setShowShortcuts,
      setValue,
      persist,
      exit,
      openSkillsPanel,
      openResumePanel,
      tokenUsage,
    });
    if (commandResult.stop) {
      return;
    }
    const userText = commandResult.userText;
    const runVerifyAfterReply = commandResult.runVerifyAfterReply;

    const userMessage = newMessage("user", userText);
    currentSession.messages.push(userMessage);
    if (currentSession.title === "New Session") {
      currentSession.title = text.trim().replace(/\s+/g, " ").slice(0, 60) || "New Session";
    }
    currentSession.updatedAt = nowIso();
    setRows((current) => [...current, { id: userMessage.id, role: "user", content: text }]);
    const referencedPaths = extractAtReferencePaths(userText);
    const fileContextMessages: Message[] = [];
    const unresolvedPaths: string[] = [];
    for (const pathInput of referencedPaths) {
      try {
        const context = await buildFileContext(pathInput);
        fileContextMessages.push(newMessage("system", context));
      } catch {
        unresolvedPaths.push(pathInput);
      }
    }
    if (unresolvedPaths.length > 0) {
      setRows((current) => [
        ...current,
        ...unresolvedPaths.map((pathInput) => ({
          id: `row_${crypto.randomUUID()}`,
          role: "system" as const,
          content: `No file or folder found: @${pathInput}`,
        })),
      ]);
      await persist();
      return;
    }

    setIsThinking(true);
    const thinkingStartedAt = Date.now();
    await persist();

    try {

      const reply = await backend.reply({
        message: userText,
        history: [...fileContextMessages, ...currentSession.messages],
        model: currentSession.model,
        sessionId: currentSession.id,
      });

      const assistantMessage = newMessage("assistant", reply.output);
      currentSession.messages.push(assistantMessage);
      currentSession.model = reply.model;
      currentSession.updatedAt = nowIso();
      setRows((current) => [
        ...current,
        { id: assistantMessage.id, role: "assistant", content: reply.output },
      ]);
      const entry: TokenUsageEntry = {
        id: assistantMessage.id,
        usage: reply.usage ?? estimateTokenUsageFallback(userText, reply.output),
        warning: reply.budgetWarning,
      };
      setTokenUsage((current) => [...current, entry]);
      if (reply.budgetWarning) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: `token budget: ${reply.budgetWarning}`,
            dim: true,
          },
        ]);
      }
      if (runVerifyAfterReply) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: "  verifying…",
            dim: true,
          },
        ]);
        try {
          const verifyResult = await runShellCommand("bun run verify");
          setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "assistant",
              content: formatVerifySummary(verifyResult),
            },
          ]);
        } catch (error) {
          setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "system",
              content: error instanceof Error ? error.message : "Verify step failed.",
            },
          ]);
        }
      }
      const durationMs = Date.now() - thinkingStartedAt;
      if (durationMs >= 300) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: `thought for ${formatThoughtDuration(durationMs)}`,
            dim: true,
          },
        ]);
      }
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
    setPicker({ kind: "skills", items: skills, index: 0 });
    setShowShortcuts(false);
  };

  const openResumePanel = (): void => {
    const items = store.sessions.slice(0, 20);
    if (items.length === 0) {
      setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "system", content: "No saved sessions." },
      ]);
      return;
    }
    const activeIndex = items.findIndex((item) => item.id === store.activeSessionId);
    setPicker({ kind: "resume", items, index: activeIndex >= 0 ? activeIndex : 0 });
    setShowShortcuts(false);
  };

  const handlePickerSelect = async (state: PickerState): Promise<void> => {
    if (state.kind === "skills") {
      const selected = state.items[state.index];
      if (selected) {
        try {
          const instructions = await readSkillInstructions(selected.path);
          const boundedInstructions =
            instructions.length > MAX_SKILL_INSTRUCTION_CHARS
              ? `${instructions.slice(0, MAX_SKILL_INSTRUCTION_CHARS - 1)}…`
              : instructions;
          const msg = newMessage("system", `Active skill (${selected.name}):\n${boundedInstructions}`);
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
      }
      setPicker(null);
      return;
    }

    const selected = state.items[state.index];
    if (selected) {
      store.activeSessionId = selected.id;
      setCurrentSession(selected);
      setRows([
        ...toRows(selected.messages),
        {
          id: `row_${crypto.randomUUID()}`,
          role: "assistant",
          content: `Resumed session: ${selected.id.slice(0, 12)}`,
        },
      ]);
      await persist();
    }
    setPicker(null);
  };

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
          {renderPickerItems(picker, store.activeSessionId)}
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
                const query = extractAtReferenceQuery(next);
                if (query !== null && atSuggestions.length > 0) {
                  const selected = atSuggestions[Math.max(0, Math.min(atSuggestionIndex, atSuggestions.length - 1))];
                  if (shouldAutocompleteAtSubmit(next, selected)) {
                    setValue(applyAtSuggestion(next, selected ?? ""));
                    setInputRevision((current) => current + 1);
                    return;
                  }
                }
                if (query === null && slashSuggestions.length > 0) {
                  const selected =
                    slashSuggestions[Math.max(0, Math.min(slashSuggestionIndex, slashSuggestions.length - 1))];
                  if (shouldAutocompleteSlashSubmit(next, selected)) {
                    setValue(applySlashSuggestion(selected ?? ""));
                    setInputRevision((current) => current + 1);
                    return;
                  }
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
            <Text dimColor>  No file or folder matches.</Text>
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

  const renderHighlighted = (value: string, keyPrefix: string): React.ReactNode => {
    const lines = value.split("\n");
    return (
      <>
        {lines.map((line, lineIndex) => (
          <React.Fragment key={`${keyPrefix}-line-${lineIndex}`}>
            {lineIndex > 0 ? "\n" : null}
            {tokenizeForHighlighting(line).map((token, tokenIndex) => {
              if (token.kind === "code") {
                return (
                  <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`} color={COLORS.highlightCode}>
                    {token.text}
                  </Text>
                );
              }
              if (token.kind === "command") {
                return (
                  <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`} bold>
                    {token.text}
                  </Text>
                );
              }
              if (token.kind === "path") {
                return (
                  <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`} underline color={COLORS.highlightPath}>
                    {token.text}
                  </Text>
                );
              }
              return <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`}>{token.text}</Text>;
            })}
          </React.Fragment>
        ))}
      </>
    );
  };

  for (const label of TOOL_LABELS) {
    if (cleaned.startsWith(`${label} `) || cleaned.startsWith(`${label}(`) || cleaned.startsWith(`${label}:`)) {
      return (
        <>
          <Text bold>{label}</Text>
          {renderHighlighted(cleaned.slice(label.length), `tool-${label}`)}
        </>
      );
    }
  }

  return renderHighlighted(cleaned, "assistant");
}
