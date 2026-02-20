import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import React, { useState } from "react";
import { useEffect } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";
import type { Backend } from "./backend";
import { appConfig } from "./app-config";
import { gitDiff, gitStatusShort, runShellCommand } from "./coding-tools";
import { addMemory, listMemories } from "./memory";
import { buildFileContext } from "./file-context";
import { PromptInput } from "./prompt-input";
import { listSkills, readSkillInstructions } from "./skills";
import { createSession } from "./storage";
import { sanitizeAssistantContent, tokenizeForHighlighting } from "./chat-content";
import { formatChangesSummary, formatDogfoodStatus, formatThoughtDuration, formatVerifySummary } from "./chat-formatters";
import { applySlashSuggestion, resolveSlashAlias, shouldAutocompleteSlashSubmit, suggestSlashCommands } from "./chat-slash";
import type { Message, Session, SessionStore } from "./types";
import type { SkillMeta } from "./skills";

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
  { key: "/memories", description: "list memories" },
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

function buildDogfoodPrompt(task: string): string {
  const preamble = [
    "Dogfood mode:",
    "- Work in small, verifiable steps.",
    "- Keep response concise and action-focused.",
    "- Use tools when needed; avoid guessing.",
    "- If edits are made, verify with bun run verify before final response.",
    "- Return: (1) what changed, (2) validation result, (3) any residual risk/blocker.",
    "- Keep output short unless asked for detail.",
    "",
  ].join("\n");
  return `${preamble}${task}`;
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
      if (atQuery !== null && atSuggestions.length > 0) {
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
      if (atQuery === null && slashSuggestions.length > 0) {
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
    const resolvedText = resolveSlashAlias(text);
    setValue("");
    if (!text || isThinking) {
      return;
    }

    const pushUserCommandRow = (): void => {
      setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "user", content: text },
      ]);
    };

    if (resolvedText === "?") {
      setShowShortcuts((current) => !current);
      return;
    }

    if (resolvedText === "/resume") {
      pushUserCommandRow();
      openResumePanel();
      return;
    }

    if (resolvedText.startsWith("/resume")) {
      pushUserCommandRow();
      const resolved = resolveResumeSession(store, resolvedText);
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
      setRows([
        ...toRows(target.messages),
        {
          id: `row_${crypto.randomUUID()}`,
          role: "assistant",
          content: `Resumed session: ${target.id.slice(0, 12)}`,
        },
      ]);
      setShowShortcuts(false);
      await persist();
      return;
    }

    if (resolvedText === "/sessions") {
      pushUserCommandRow();
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

    if (resolvedText === "/status") {
      pushUserCommandRow();
      try {
        const status = await backend.status();
        setRows((current) => [
          ...current,
          { id: `row_${crypto.randomUUID()}`, role: "assistant", content: status },
        ]);
      } catch (error) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: error instanceof Error ? error.message : "Status check failed.",
          },
        ]);
      }
      return;
    }

    if (resolvedText === "/changes") {
      pushUserCommandRow();
      try {
        const [statusRaw, diffRaw] = await Promise.all([gitStatusShort(), gitDiff()]);
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: formatChangesSummary(statusRaw, diffRaw),
          },
        ]);
      } catch (error) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: error instanceof Error ? error.message : "Could not inspect git changes.",
          },
        ]);
      }
      return;
    }

    if (resolvedText === "/dogfood-status") {
      pushUserCommandRow();
      setRows((current) => [
        ...current,
        {
          id: `row_${crypto.randomUUID()}`,
          role: "system",
          content: "Checking dogfood status…",
          dim: true,
        },
      ]);
      try {
        const [backendStatus, verifyRaw] = await Promise.all([
          backend.status().catch((error) => (error instanceof Error ? error.message : "status unavailable")),
          runShellCommand("bun run verify", 30_000).catch((error) =>
            error instanceof Error ? `exit_code=1\nduration_ms=0\nstderr:\n${error.message}` : "exit_code=1\nduration_ms=0",
          ),
        ]);
        const verifySummary = formatVerifySummary(verifyRaw);
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: formatDogfoodStatus({
              backendStatus,
              verifySummary,
              hasApiKey: Boolean(appConfig.openai.apiKey),
            }),
          },
        ]);
      } catch (error) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: error instanceof Error ? error.message : "Could not run dogfood status checks.",
          },
        ]);
      }
      return;
    }

    if (resolvedText === "/memories") {
      pushUserCommandRow();
      const memories = await listMemories();
      if (memories.length === 0) {
        setRows((current) => [
          ...current,
          { id: `row_${crypto.randomUUID()}`, role: "system", content: "No memories saved." },
        ]);
        return;
      }
      setRows((current) => [
        ...current,
        {
          id: `row_${crypto.randomUUID()}`,
          role: "system",
          content: `Memories (${memories.length})`,
        },
        ...memories.slice(0, 10).map((entry) => ({
          id: `row_${crypto.randomUUID()}`,
          role: "system" as const,
          content: `- [${entry.scope}] ${entry.content}`,
        })),
      ]);
      return;
    }

    if (resolvedText.startsWith("/remember")) {
      pushUserCommandRow();
      const parts = resolvedText.split(/\s+/).slice(1);
      let scope: "user" | "project" = "user";
      const contentParts: string[] = [];
      for (const part of parts) {
        if (part === "--project") {
          scope = "project";
          continue;
        }
        if (part === "--user") {
          scope = "user";
          continue;
        }
        contentParts.push(part);
      }
      const content = contentParts.join(" ").trim();
      if (!content) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: "Usage: /remember [--user|--project] <memory text>",
          },
        ]);
        return;
      }
      try {
        const entry = await addMemory(content, { scope });
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: `Saved ${entry.scope} memory: ${content}`,
          },
        ]);
      } catch (error) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: error instanceof Error ? error.message : "Failed to save memory.",
          },
        ]);
      }
      return;
    }

    if (resolvedText === "/skills") {
      pushUserCommandRow();
      await openSkillsPanel();
      return;
    }

    if (resolvedText === "/new") {
      pushUserCommandRow();
      const next = createSession(currentSession.model);
      store.sessions.unshift(next);
      store.activeSessionId = next.id;
      setCurrentSession(next);
      setRows((current) => [
        ...current,
        {
          id: `row_${crypto.randomUUID()}`,
          role: "assistant",
          content: `Started new session: ${next.id.slice(0, 12)}`,
        },
      ]);
      setValue("");
      setShowShortcuts(false);
      await persist();
      return;
    }

    if (resolvedText === "/exit") {
      pushUserCommandRow();
      await persist();
      exit();
      return;
    }

    if (resolvedText.startsWith("/")) {
      pushUserCommandRow();
      if (resolvedText === "/skill" || resolvedText.startsWith("/skill ")) {
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

    let userText = text;
    let runVerifyAfterReply = false;
    if (resolvedText.startsWith("/dogfood")) {
      const parts = resolvedText.split(/\s+/).slice(1);
      let noVerify = false;
      const taskParts: string[] = [];
      for (const part of parts) {
        if (part === "--no-verify") {
          noVerify = true;
          continue;
        }
        taskParts.push(part);
      }
      const task = taskParts.join(" ").trim();
      if (!task) {
        setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: "Usage: /dogfood [--no-verify] <task>",
          },
        ]);
        return;
      }
      runVerifyAfterReply = !noVerify;
      userText = buildDogfoodPrompt(task);
      setRows((current) => [
        ...current,
        {
          id: `row_${crypto.randomUUID()}`,
          role: "system",
          content: runVerifyAfterReply
            ? "Dogfood mode enabled (verify after reply)."
            : "Dogfood mode enabled (no verify).",
        },
      ]);
    }

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
