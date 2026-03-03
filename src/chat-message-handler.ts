import { formatToolHeader } from "./agent-output";
import { appConfig } from "./app-config";
import { type ChatRow, createRow, dispatchSlashCommand, type TokenUsageEntry } from "./chat-commands";
import { invalidateRepoPathCandidates } from "./chat-file-ref";
import type { Message } from "./chat-message";
import { createProgressTracker } from "./chat-progress";
import { isKnownSlashToken, resolveSlashAlias } from "./chat-slash";
import {
  appendInputHistory,
  applyUserTurn,
  resolveReferencedFileContext,
  runAssistantTurn,
  unresolvedPathRows,
} from "./chat-turn";
import {
  distillMemoryCandidate,
  formatSubmitError,
  isAbortError,
  isLikelyWritePrompt,
  mergeAssistantTranscript,
  parseInternalWriteResumeTurn,
  resolveNaturalRememberDirective,
  statusPermissionMode,
} from "./chat-message-handler-helpers";
import type { Client } from "./client";
import { addMemory } from "./memory";
import type { Session, SessionStore } from "./session-types";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { mergeToolOutputHeader, shouldSuppressEmptyToolProgressRow } from "./tool-summary-format";

type CreateMessageHandlerInput = {
  client: Client;
  store: SessionStore;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  toRows: (messages: Message[]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openModelPanel: () => void;
  openWriteConfirmPanel: (prompt: string) => void;
  tokenUsage: TokenUsageEntry[];
  isWorking: boolean;
  setInputHistory: (updater: (current: string[]) => string[]) => void;
  setInputHistoryIndex: (next: number) => void;
  setInputHistoryDraft: (next: string) => void;
  startWorking?: () => void;
  stopWorking?: () => void;
  setIsWorking?: (next: boolean) => void;
  setProgressText: (next: string | null) => void;
  setTokenUsage: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
  setInterrupt: (handler: (() => void) | null) => void;
  useMemory?: boolean;
};

function remoteTaskIdFromError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const taskId = (error as Error & { taskId?: unknown }).taskId;
  return typeof taskId === "string" && taskId.length > 0 ? taskId : null;
}

export function createMessageHandler(input: CreateMessageHandlerInput): (raw: string) => Promise<void> {
  const startWorking = (): void => {
    if (input.startWorking) {
      input.startWorking();
      return;
    }
    input.setIsWorking?.(true);
  };

  const stopWorking = (): void => {
    if (input.stopWorking) {
      input.stopWorking();
      return;
    }
    input.setIsWorking?.(false);
  };

  return async (raw: string): Promise<void> => {
    const internalWriteResume = parseInternalWriteResumeTurn(raw);
    const isInternalReplay = Boolean(internalWriteResume);
    const text = internalWriteResume ? internalWriteResume.prompt : raw.trim();
    if (!text || (input.isWorking && !text.startsWith("/"))) return;
    if (!isInternalReplay && text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) return;
    const resolvedText = resolveSlashAlias(text);
    const naturalRememberDirective = isInternalReplay ? null : resolveNaturalRememberDirective(text);
    const dispatchResolvedText = resolvedText;
    if (!isInternalReplay) {
      input.setInputHistory((current) => appendInputHistory(current, text));
      input.setInputHistoryIndex(-1);
      input.setInputHistoryDraft("");
    }
    input.setValue("");

    if (resolvedText === "?") {
      input.setShowHelp((current) => !current);
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
      startWorking();
      input.setProgressText("Thinking…");
      try {
        const distilled = distillMemoryCandidate(naturalRememberDirective.content);
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
        stopWorking();
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
        setShowHelp: input.setShowHelp,
        setValue: input.setValue,
        persist: input.persist,
        exit: input.exit,
        openSkillsPanel: input.openSkillsPanel,
        activateSkill: input.activateSkill,
        openResumePanel: input.openResumePanel,
        openPermissionsPanel: input.openPermissionsPanel,
        openModelPanel: input.openModelPanel,
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
    } else {
      userText = text;
    }
    const { row: userRow } = applyUserTurn({
      session: input.currentSession,
      displayText: text,
      userText,
      nowIso: input.nowIso,
      createMessage: input.createMessage,
    });
    input.setRows((current) => [...current, userRow]);

    const { contexts, unresolvedPaths } = await resolveReferencedFileContext(userText);
    const fileContextMessages: Message[] = contexts.map((context) => input.createMessage("system", context));
    if (unresolvedPaths.length > 0) input.setRows((current) => [...current, ...unresolvedPathRows(unresolvedPaths)]);
    if (unresolvedPaths.length > 0 && contexts.length === 0) {
      await input.persist();
      return;
    }

    startWorking();
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
    const toolHasBodyOutputByCallId = new Set<string>();
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
          const mergedHeader = !existingRow.content.includes("\n")
            ? mergeToolOutputHeader(existingRow.content, entry.toolName, content)
            : null;
          if (mergedHeader) {
            toolHasBodyOutputByCallId.add(entry.toolCallId);
            next[existingIndex] = {
              ...existingRow,
              content: mergedHeader,
            };
            return next;
          }
          toolHasBodyOutputByCallId.add(entry.toolCallId);
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
          toolHasBodyOutputByCallId.delete(entry.toolCallId);
          if (!rowId) return;
          input.setRows((current) => current.filter((row) => row.id !== rowId));
          return;
        }
        if (!toolHasBodyOutputByCallId.has(entry.toolCallId) && shouldSuppressEmptyToolProgressRow(entry.toolName)) {
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
    let keepThinkingForRemoteTask = false;

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
      flushPendingToolRows();
      const streamedAssistantText = `${committedStreamingText}${streamingAssistantContent}`;
      // Capture the streaming row id before clearing so we can remove it atomically
      // with the final rows to avoid a visual jump.
      const pendingStreamRowId = streamingAssistantRowId;
      streamingAssistantRowId = null;
      streamingAssistantContent = "";
      const mergedAssistantOutput = mergeAssistantTranscript(streamedAssistantText, assistantMessage.content);
      assistantMessage.content = mergedAssistantOutput;

      const finalizeRows = (rows: ChatRow[]): ChatRow[] =>
        rows
          .filter((row) => row.id !== pendingStreamRowId)
          .map((row) => {
            if (row.style !== "toolProgress" || row.content.includes("\n")) return row;
            if (row.toolName === "run-command") return { ...row, content: `${row.content}\n(No output)` };
            return row;
          });

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
          const mergedContent = mergeAssistantTranscript(streamedAssistantText, r.content);
          if (committedStreamingText && mergedContent.startsWith(committedStreamingText)) {
            const after = mergedContent.slice(committedStreamingText.length).trim();
            if (!after) return null;
            return isRedundantWithHeader(after) ? null : { ...r, content: after };
          }
          return isRedundantWithHeader(mergedContent.trim()) ? null : { ...r, content: mergedContent };
        })
        .filter((r): r is ChatRow => r !== null);
      input.setRows((current) => [...finalizeRows(current), ...finalRows]);
      // File tree may have changed during tool execution; refresh @path autocomplete candidates.
      invalidateRepoPathCandidates();
      input.currentSession.tokenUsage.push(turn.tokenEntry);
      input.setTokenUsage(() => [...input.currentSession.tokenUsage]);
      await input.persist();
    } catch (error) {
      const remoteTaskId = remoteTaskIdFromError(error);
      if (!isAbortError(error) && remoteTaskId) {
        try {
          const task = await input.client.taskStatus(remoteTaskId);
          if (task && (task.state === "running" || task.state === "detached")) {
            keepThinkingForRemoteTask = true;
            input.setProgressText("Still running on server…");
            void (async () => {
              try {
                for (let pollCount = 0; pollCount < 300; pollCount += 1) {
                  await Bun.sleep(700);
                  const next = await input.client.taskStatus(remoteTaskId);
                  if (!next || next.state === "running" || next.state === "detached") continue;
                  if (next.state === "failed") {
                    const detail = next.summary?.trim() || "Task failed on server.";
                    input.setRows((current) => [
                      ...current,
                      createRow("system", detail, { dim: true, style: "error" }),
                    ]);
                  } else if (next.state === "cancelled") {
                    const detail = next.summary?.trim() || "Task cancelled.";
                    input.setRows((current) => [
                      ...current,
                      createRow("system", detail, { dim: true, style: "cancelled" }),
                    ]);
                  }
                  await input.persist();
                  return;
                }
                input.setRows((current) => [
                  ...current,
                  createRow("system", "Task is still running. Use /status to check server health.", { dim: true }),
                ]);
              } catch {
                input.setRows((current) => [
                  ...current,
                  createRow("system", "Lost task tracking after stream disconnect.", { dim: true, style: "error" }),
                ]);
              } finally {
                stopWorking();
                input.setProgressText(null);
                await input.persist().catch(() => {});
              }
            })();
            return;
          }
        } catch {
          // Fall through to normal error handling if task status lookup fails.
        }
      }
      // Persist any partial assistant content so context isn't lost on timeout/error.
      const partialContent = (committedStreamingText + streamingAssistantContent).trim();
      if (partialContent.length > 0 && !isAbortError(error)) {
        const partialMessage = input.createMessage("assistant", partialContent);
        input.currentSession.messages.push(partialMessage);
        input.currentSession.updatedAt = input.nowIso();
        await input.persist().catch(() => {});
      }
      const errorContent = isAbortError(error) ? "Interrupted" : formatSubmitError(error);
      input.setRows((current) => [
        ...current,
        createRow("system", errorContent, {
          dim: isAbortError(error),
          style: isAbortError(error) ? "cancelled" : "error",
        }),
      ]);
    } finally {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      input.setInterrupt(null);
      if (!keepThinkingForRemoteTask) {
        stopWorking();
        input.setProgressText(null);
      }
    }
  };
}
