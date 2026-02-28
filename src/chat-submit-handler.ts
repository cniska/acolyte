import { formatToolHeader } from "./agent";
import { appConfig } from "./app-config";
import { type ChatRow, createRow, dispatchSlashCommand, type TokenUsageEntry } from "./chat-commands";
import { invalidateRepoPathCandidates } from "./chat-file-ref";
import { createProgressTracker } from "./chat-progress";
import { isKnownSlashToken, resolveSlashAlias } from "./chat-slash";
import {
  appendInputHistory,
  applyUserTurn,
  resolveReferencedFileContext,
  runAssistantTurn,
  unresolvedPathRows,
} from "./chat-turn";
import type { Client } from "./client";
import type { PermissionMode } from "./config-modes";
import { addMemory, type MemoryScope } from "./memory";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import type { Message, Session, SessionStore } from "./types";

type CreateSubmitHandlerInput = {
  client: Client;
  store: SessionStore;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  toRows: (messages: Message[]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowShortcuts: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openClarifyPanel: (questions: string[], originalPrompt: string) => void;
  openWriteConfirmPanel: (prompt: string) => void;
  tokenUsage: TokenUsageEntry[];
  isThinking: boolean;
  setInputHistory: (updater: (current: string[]) => string[]) => void;
  setInputHistoryIndex: (next: number) => void;
  setInputHistoryDraft: (next: string) => void;
  setIsThinking: (next: boolean) => void;
  setProgressText: (next: string | null) => void;
  setTokenUsage: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
  setInterrupt: (handler: (() => void) | null) => void;
  useMemory?: boolean;
};

type ClarificationAnswer = { question: string; answer: string };
type InternalClarificationTurn = {
  originalPrompt: string;
  answers: ClarificationAnswer[];
};
type InternalWriteResumeTurn = {
  prompt: string;
};
const INTERNAL_CLARIFICATION_PREFIX = "\u0000acolyte_clarify:";
const INTERNAL_WRITE_RESUME_PREFIX = "\u0000acolyte_write_resume:";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatSubmitError(error: unknown): string {
  if (!(error instanceof Error)) return "Request failed. Retry and check server logs if it keeps failing.";
  const message = error.message.trim();
  const lower = message.toLowerCase();
  if (lower.includes("insufficient_quota") || lower.includes("quota exceeded") || lower.includes("quota"))
    return "Provider quota exceeded. Add billing/credits or switch model/provider.";
  if (lower.includes("timed out") || lower.includes("timeout"))
    return "Server request timed out. Retry or reduce request scope.";
  if (lower.includes("shell command execution is disabled in read mode"))
    return "Write action blocked in read mode. Run /permissions write and retry.";
  if (
    lower.includes("server unavailable") ||
    lower.includes("connection refused") ||
    lower.includes("socket connection was closed unexpectedly")
  ) {
    return "Server unavailable. Start the server and retry.";
  }
  if (lower.includes("remote server error")) return message;
  return message || "Request failed. Retry and check server logs if it keeps failing.";
}

function isLikelyWritePrompt(text: string): boolean {
  return /\b(add|edit|modify|update|change|fix|insert|refactor|rewrite|rename|create|delete|implement|apply patch|write)\b/i.test(
    text,
  );
}

function statusPermissionMode(status: Record<string, string>): PermissionMode | null {
  const mode = status.permissions;
  if (mode === "read" || mode === "write") return mode;
  return null;
}

type NaturalRememberDirective = {
  scope: MemoryScope;
  content: string;
};

function cleanMemoryCandidate(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/^memory\s*[:-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveNaturalRememberDirective(text: string): NaturalRememberDirective | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const trailingProjectRememberThisMatch = trimmed.match(/^(.+?)(?:,\s*|\s+)remember this for project$/i);
  if (trailingProjectRememberThisMatch?.[1])
    return { scope: "project", content: trailingProjectRememberThisMatch[1].trim() };
  const trailingUserRememberThisMatch = trimmed.match(/^(.+?)(?:,\s*|\s+)remember this(?: for user)?$/i);
  if (trailingUserRememberThisMatch?.[1]) return { scope: "user", content: trailingUserRememberThisMatch[1].trim() };
  const projectMatch = trimmed.match(/^remember this for project[:\s]+(.+)$/i);
  if (projectMatch?.[1]) return { scope: "project", content: projectMatch[1].trim() };
  const userMatch = trimmed.match(/^remember this(?: for user)?[:\s]+(.+)$/i);
  if (userMatch?.[1]) return { scope: "user", content: userMatch[1].trim() };
  const bareRememberMatch = trimmed.match(/^remember\s+(.+)$/i);
  if (bareRememberMatch?.[1]) {
    const content = bareRememberMatch[1].trim();
    if (/^this$/i.test(content)) return null;
    return { scope: "user", content };
  }
  const trailingRememberMatch = trimmed.match(/^(.+?)\s+remember$/i);
  if (trailingRememberMatch?.[1]) return { scope: "user", content: trailingRememberMatch[1].trim() };
  return null;
}

export function extractClarifyingQuestions(output: string): string[] {
  const lines = output.split("\n").map((line) => line.trim());
  const headingIndex = lines.findIndex((line) => /^(?:[-*]\s*)?clarifying questions\s*:?\s*$/i.test(line));
  if (headingIndex < 0) return [];
  const questions: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.length === 0) {
      if (questions.length > 0) break;
      continue;
    }
    const numbered = line.match(/^\d+[).]\s+(.+)$/);
    if (!numbered?.[1]) {
      if (questions.length > 0) break;
      continue;
    }
    questions.push(numbered[1].trim());
  }
  return questions;
}

export function buildInternalClarificationTurn(turn: InternalClarificationTurn): string {
  return `${INTERNAL_CLARIFICATION_PREFIX}${JSON.stringify(turn)}`;
}

export function buildInternalWriteResumeTurn(prompt: string): string {
  return `${INTERNAL_WRITE_RESUME_PREFIX}${prompt}`;
}

function parseInternalClarificationTurn(raw: string): InternalClarificationTurn | null {
  if (!raw.startsWith(INTERNAL_CLARIFICATION_PREFIX)) return null;
  const payload = raw.slice(INTERNAL_CLARIFICATION_PREFIX.length);
  try {
    const parsed = JSON.parse(payload) as Partial<InternalClarificationTurn>;
    if (!parsed || typeof parsed !== "object") return null;
    const originalPrompt = typeof parsed.originalPrompt === "string" ? parsed.originalPrompt.trim() : "";
    const answers = Array.isArray(parsed.answers)
      ? parsed.answers
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const question =
              typeof (item as { question?: unknown }).question === "string"
                ? (item as { question: string }).question.trim()
                : "";
            const answer =
              typeof (item as { answer?: unknown }).answer === "string"
                ? (item as { answer: string }).answer.trim()
                : "";
            if (!question || !answer) return null;
            return { question, answer };
          })
          .filter((item): item is ClarificationAnswer => Boolean(item))
      : [];
    if (!originalPrompt || answers.length === 0) return null;
    return { originalPrompt, answers };
  } catch {
    return null;
  }
}

function parseInternalWriteResumeTurn(raw: string): InternalWriteResumeTurn | null {
  if (!raw.startsWith(INTERNAL_WRITE_RESUME_PREFIX)) return null;
  const prompt = raw.slice(INTERNAL_WRITE_RESUME_PREFIX.length).trim();
  if (!prompt) return null;
  return { prompt };
}

function buildClarifiedUserText(turn: InternalClarificationTurn): string {
  const lines = turn.answers.map((item) => `- ${item.question}: ${item.answer}`);
  return `${turn.originalPrompt}\n\nClarifications:\n${lines.join("\n")}`;
}

export function createSubmitHandler(input: CreateSubmitHandlerInput): (raw: string) => Promise<void> {
  return async (raw: string): Promise<void> => {
    const internalClarification = parseInternalClarificationTurn(raw);
    const internalWriteResume = parseInternalWriteResumeTurn(raw);
    const isInternalReplay = Boolean(internalClarification || internalWriteResume);
    const text = internalClarification
      ? internalClarification.originalPrompt
      : internalWriteResume
        ? internalWriteResume.prompt
        : raw.trim();
    if (!text || (input.isThinking && !text.startsWith("/"))) return;
    if (!isInternalReplay && text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) return;
    const resolvedText = internalClarification ? text : resolveSlashAlias(text);
    const naturalRememberDirective = isInternalReplay ? null : resolveNaturalRememberDirective(text);
    const dispatchResolvedText = resolvedText;
    if (!isInternalReplay) {
      input.setInputHistory((current) => appendInputHistory(current, text));
      input.setInputHistoryIndex(-1);
      input.setInputHistoryDraft("");
    }
    input.setValue("");

    if (!internalClarification && resolvedText === "?") {
      input.setShowShortcuts((current) => !current);
      return;
    }
    if (naturalRememberDirective) {
      const { row: userRow } = applyUserTurn({
        session: input.currentSession,
        displayText: text,
        userText: text,
        nowIso: input.nowIso,
        createMessage: input.createMessage,
      });
      input.setRows((current) => [...current, userRow]);
      input.setIsThinking(true);
      input.setProgressText("Thinking…");
      try {
        const distilled = cleanMemoryCandidate(naturalRememberDirective.content);
        await addMemory(distilled, { scope: naturalRememberDirective.scope });
        const label = naturalRememberDirective.scope === "project" ? "project" : "user";
        const confirmation = `Saved ${label} memory: ${distilled}`;
        const assistant = input.createMessage("assistant", confirmation);
        input.currentSession.messages.push(assistant);
        input.currentSession.updatedAt = input.nowIso();
        input.setRows((current) => [...current, createRow("system", confirmation, { dim: true })]);
        await input.persist();
      } catch (error) {
        input.setRows((current) => [
          ...current,
          createRow("system", error instanceof Error ? error.message : "Failed to save memory.", { dim: true }),
        ]);
      } finally {
        input.setIsThinking(false);
        input.setProgressText(null);
      }
      return;
    }
    let userText = text;
    if (!isInternalReplay) {
      const commandResult = await dispatchSlashCommand({
        text,
        resolvedText: dispatchResolvedText,
        client: input.client,
        store: input.store,
        currentSession: input.currentSession,
        setCurrentSession: input.setCurrentSession,
        setTokenUsage: input.setTokenUsage,
        toRows: (messages) => input.toRows(messages),
        setRows: input.setRows,
        setShowShortcuts: input.setShowShortcuts,
        setValue: input.setValue,
        persist: input.persist,
        exit: input.exit,
        openSkillsPanel: input.openSkillsPanel,
        activateSkill: input.activateSkill,
        openResumePanel: input.openResumePanel,
        openPermissionsPanel: input.openPermissionsPanel,
        setServerPermissionMode: input.client.setPermissionMode,
        tokenUsage: input.tokenUsage,
      });
      if (commandResult.stop) return;
      if (!internalWriteResume && isLikelyWritePrompt(text)) {
        try {
          const status = await input.client.status();
          if (statusPermissionMode(status) === "read") {
            input.setRows((current) => [
              ...current,
              createRow("system", "Write request needs confirmation in read mode."),
            ]);
            input.openWriteConfirmPanel(text);
            return;
          }
        } catch {
          // Best-effort check; continue normally if status lookup fails.
        }
      }
      userText = commandResult.userText;
    } else if (internalClarification) {
      userText = buildClarifiedUserText(internalClarification);
    } else {
      userText = text;
    }

    if (internalClarification) {
      const userMessage = input.createMessage("user", userText);
      input.currentSession.messages.push(userMessage);
      if (input.currentSession.title === "New Session") {
        input.currentSession.title =
          internalClarification.originalPrompt.trim().replace(/\s+/g, " ").slice(0, 60) || "New Session";
      }
      input.currentSession.updatedAt = input.nowIso();
    } else {
      const { row: userRow } = applyUserTurn({
        session: input.currentSession,
        displayText: text,
        userText,
        nowIso: input.nowIso,
        createMessage: input.createMessage,
      });
      input.setRows((current) => [...current, userRow]);
    }

    const { contexts, unresolvedPaths } = await resolveReferencedFileContext(userText);
    const fileContextMessages: Message[] = contexts.map((context) => input.createMessage("system", context));
    if (unresolvedPaths.length > 0) input.setRows((current) => [...current, ...unresolvedPathRows(unresolvedPaths)]);
    if (unresolvedPaths.length > 0 && contexts.length === 0) {
      await input.persist();
      return;
    }

    input.setIsThinking(true);
    input.setProgressText("Thinking…");
    const abortController = new AbortController();
    input.setInterrupt(() => abortController.abort());
    const thinkingStartedAt = Date.now();
    let streamingAssistantRowId: string | null = null;
    let streamingAssistantContent = "";
    let committedStreamingText = "";
    const toolRowIdByCallId = new Map<string, string>();
    const toolSeenLinesByCallId = new Map<string, Set<string>>();
    const pendingToolCallById = new Map<string, { header: string; toolName: string }>();
    const toolHeaders = new Set<string>();
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const STREAM_FLUSH_MS = 50;
    const flushStreamingContent = (): void => {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      if (streamingAssistantContent.trim().length === 0) return;
      input.setRows((current) => {
        if (!streamingAssistantRowId) {
          streamingAssistantRowId = `row_${createId()}`;
          return [
            ...current,
            {
              id: streamingAssistantRowId,
              role: "assistant",
              content: streamingAssistantContent,
            },
          ];
        }
        return current.map((row) =>
          row.id === streamingAssistantRowId ? { ...row, content: streamingAssistantContent } : row,
        );
      });
    };
    const ensureToolRow = (toolCallId: string): void => {
      const pending = pendingToolCallById.get(toolCallId);
      if (!pending) return;
      if (toolRowIdByCallId.get(toolCallId)) return;
      const rowId = `row_${createId()}`;
      toolRowIdByCallId.set(toolCallId, rowId);
      toolSeenLinesByCallId.set(toolCallId, new Set([pending.header.toLowerCase()]));
      toolHeaders.add(pending.header.toLowerCase());
      const toolRow: ChatRow = {
        id: rowId,
        role: "assistant",
        content: pending.header,
        style: "toolProgress",
        toolCallId,
        toolName: pending.toolName,
      };
      if (streamingAssistantContent.trim().length > 0) committedStreamingText += streamingAssistantContent;
      streamingAssistantRowId = null;
      streamingAssistantContent = "";
      input.setRows((current) => [...current, toolRow]);
      pendingToolCallById.delete(toolCallId);
    };
    const flushPendingToolRows = (): void => {
      for (const toolCallId of [...pendingToolCallById.keys()]) ensureToolRow(toolCallId);
    };

    const progressTracker = createProgressTracker({
      onStatus: (message) => {
        input.setProgressText(message);
      },
      onAssistant: (delta) => {
        if (delta.length === 0) return;
        streamingAssistantContent += delta;
        if (!streamFlushTimer) streamFlushTimer = setTimeout(flushStreamingContent, STREAM_FLUSH_MS);
      },
      onToolCall: (entry) => {
        const header = formatToolHeader(entry.toolName, entry.args);
        pendingToolCallById.set(entry.toolCallId, { header, toolName: entry.toolName });
      },
      onToolOutput: (entry) => {
        const content = entry.content.trim();
        if (!content) return;
        ensureToolRow(entry.toolCallId);
        input.setRows((current) => {
          const normalizedLine = content.toLowerCase();
          const seenLines = toolSeenLinesByCallId.get(entry.toolCallId) ?? new Set<string>();
          if (seenLines.has(normalizedLine)) return current;
          seenLines.add(normalizedLine);
          toolSeenLinesByCallId.set(entry.toolCallId, seenLines);
          const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
          const existingIndex = existingRowId ? current.findIndex((row) => row.id === existingRowId) : -1;
          const existingRow = existingIndex >= 0 ? current[existingIndex] : undefined;
          if (!existingRow) {
            const rowId = `row_${createId()}`;
            toolRowIdByCallId.set(entry.toolCallId, rowId);
            return [
              ...current,
              {
                id: rowId,
                role: "assistant",
                content,
                style: "toolProgress",
                toolCallId: entry.toolCallId,
                toolName: entry.toolName,
              },
            ];
          }
          const next = [...current];
          next[existingIndex] = {
            ...existingRow,
            content: `${existingRow.content}\n${content}`,
          };
          return next;
        });
      },
      onToolResult: (entry) => {
        const guardBlocked =
          entry.isError &&
          (entry.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || entry.errorDetail?.category === "guard-blocked");
        if (guardBlocked) {
          pendingToolCallById.delete(entry.toolCallId);
          const rowId = toolRowIdByCallId.get(entry.toolCallId);
          toolRowIdByCallId.delete(entry.toolCallId);
          toolSeenLinesByCallId.delete(entry.toolCallId);
          if (!rowId) return;
          input.setRows((current) => current.filter((row) => row.id !== rowId));
          return;
        }
        ensureToolRow(entry.toolCallId);
        const rowId = toolRowIdByCallId.get(entry.toolCallId);
        if (!rowId) return;
        const status: ChatRow["toolStatus"] = entry.isError ? "error" : "ok";
        input.setRows((current) => current.map((row) => (row.id === rowId ? { ...row, toolStatus: status } : row)));
      },
      onError: (error) => {
        input.setRows((current) => {
          const last = current[current.length - 1];
          if (last?.style === "error" && last.content === error) return current;
          return [...current, createRow("system", error, { dim: true, style: "error" })];
        });
      },
    });
    await input.persist();

    try {
      const turn = await runAssistantTurn({
        client: input.client,
        userText,
        history: [...fileContextMessages, ...input.currentSession.messages],
        model: appConfig.model,
        sessionId: input.currentSession.id,
        useMemory: input.useMemory,
        signal: abortController.signal,
        onEvent: (event) => {
          progressTracker.apply(event);
        },
        thinkingStartedAt,
        createMessage: input.createMessage,
      });
      const assistantMessage = turn.assistantMessage;
      const clarifyingQuestions = extractClarifyingQuestions(assistantMessage.content);
      flushPendingToolRows();
      // Capture the streaming row id before clearing so we can remove it atomically
      // with the final rows to avoid a visual jump.
      const pendingStreamRowId = streamingAssistantRowId;
      streamingAssistantRowId = null;
      streamingAssistantContent = "";

      const finalizeRows = (rows: ChatRow[]): ChatRow[] =>
        rows
          .filter((row) => row.id !== pendingStreamRowId)
          .map((row) => {
            if (row.style !== "toolProgress" || row.content.includes("\n")) return row;
            if (row.toolName === "run-command") return { ...row, content: `${row.content}\n(No output)` };
            return row;
          });

      if (clarifyingQuestions.length > 0) {
        const nonAssistantRows = turn.rows.filter((row) => row.role !== "assistant");
        input.setRows((current) => [...finalizeRows(current), ...nonAssistantRows]);
        input.openClarifyPanel(clarifyingQuestions, text);
      } else {
        input.currentSession.messages.push(assistantMessage);
        input.currentSession.updatedAt = input.nowIso();
        // When pre-tool text was committed in place, strip the prefix
        // from the final assistant row to avoid duplication. Use a
        // proper prefix check instead of blind character slicing.
        const detailAfterVerb = (s: string): string =>
          s
            .trim()
            .replace(/^\S+\s*/, "")
            .replace(/\.+$/, "")
            .toLowerCase();
        const headerDetails = new Set([...toolHeaders].map(detailAfterVerb).filter((d) => d.length > 0));
        const isRedundantWithHeader = (text: string): boolean => {
          return headerDetails.size > 0 && headerDetails.has(detailAfterVerb(text));
        };
        const finalRows = turn.rows
          .map((r) => {
            if (r.role !== "assistant" || r.dim || r.style) return r;
            if (committedStreamingText && r.content.startsWith(committedStreamingText)) {
              const after = r.content.slice(committedStreamingText.length).trim();
              if (!after) return null;
              return isRedundantWithHeader(after) ? null : { ...r, content: after };
            }
            return isRedundantWithHeader(r.content.trim()) ? null : r;
          })
          .filter((r): r is ChatRow => r !== null);
        input.setRows((current) => [...finalizeRows(current), ...finalRows]);
      }
      // File tree may have changed during tool execution; refresh @path autocomplete candidates.
      invalidateRepoPathCandidates();
      input.currentSession.tokenUsage.push(turn.tokenEntry);
      input.setTokenUsage(() => [...input.currentSession.tokenUsage]);
      await input.persist();
    } catch (error) {
      // Persist any partial assistant content so context isn't lost on timeout/error.
      const partialContent = (committedStreamingText + streamingAssistantContent).trim();
      if (partialContent.length > 0 && !isAbortError(error)) {
        const partialMessage = input.createMessage("assistant", partialContent);
        input.currentSession.messages.push(partialMessage);
        input.currentSession.updatedAt = input.nowIso();
        await input.persist().catch(() => {});
      }
      const errorContent = isAbortError(error) ? "Interrupted." : formatSubmitError(error);
      input.setRows((current) => [...current, createRow("system", errorContent, { dim: isAbortError(error) })]);
    } finally {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      input.setInterrupt(null);
      input.setIsThinking(false);
      input.setProgressText(null);
    }
  };
}
