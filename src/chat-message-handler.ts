import type { AgentMode } from "./agent-modes";
import { appConfig } from "./app-config";
import { type ChatRow, createRow, dispatchSlashCommand, type TokenUsageEntry } from "./chat-commands";
import { invalidateRepoPathCandidates } from "./chat-file-ref";
import type { Message } from "./chat-message";
import { buildFinalAssistantRows, finalizeToolProgressRows } from "./chat-message-handler-finalize";
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
import { createMessageStreamState } from "./chat-message-handler-stream";
import { startRemoteTaskFollowup } from "./chat-message-handler-task-followup";
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
import { t } from "./i18n";
import { addMemory } from "./memory";
import type { Session, SessionState } from "./session-contract";

type CreateMessageHandlerInput = {
  client: Client;
  store: SessionState;
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
  openModelPanel: (mode?: AgentMode) => void;
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
      input.setProgressText(t("progress.thinking"));
      try {
        const distilled = distillMemoryCandidate(naturalRememberDirective.content);
        await addMemory(distilled, { scope: naturalRememberDirective.scope });
        const label = naturalRememberDirective.scope === "project" ? "project" : "user";
        const confirmation = t("remember.saved", { scope: label, content: distilled });
        const assistant = input.createMessage("assistant", confirmation);
        input.currentSession.messages.push(assistant);
        input.currentSession.updatedAt = input.nowIso();
        input.setRows((current) => [...current, createRow("system", confirmation, { dim: true })]);
        await input.persist();
      } catch (error) {
        input.setRows((current) => [
          ...current,
          createRow("system", error instanceof Error ? error.message : t("remember.failed"), { dim: true }),
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
            input.setRows((current) => [...current, createRow("system", t("write.confirm.required"))]);
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
    input.setProgressText(t("progress.thinking"));
    const abortController = new AbortController();
    input.setInterrupt(() => abortController.abort());
    const thinkingStartedAt = Date.now();
    const streamState = createMessageStreamState({
      setRows: input.setRows,
    });

    const progressTracker = createProgressTracker({
      onStatus: (message) => {
        input.setProgressText(message);
      },
      onAssistant: (delta) => {
        if (streamState.onAssistantDelta(delta)) streamState.scheduleStreamFlush();
      },
      onToolCall: streamState.onToolCall,
      onToolOutput: streamState.onToolOutput,
      onToolResult: streamState.onToolResult,
      onError: streamState.onProgressError,
    });
    await input.persist();
    let keepThinkingForRemoteTask = false;

    try {
      const turn = await runAssistantTurn({
        client: input.client,
        userText,
        history: [...fileContextMessages, ...input.currentSession.messages],
        model: input.currentSession.model,
        modeModels: appConfig.models,
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
      streamState.flushPendingToolRows();
      const streamedAssistantText = streamState.streamedAssistantText();
      // Capture the streaming row id before clearing so we can remove it atomically
      // with the final rows to avoid a visual jump.
      const pendingStreamRowId = streamState.clearStreamingAssistantRow();
      streamState.clearStreamingAssistantContent();
      const mergedAssistantOutput = mergeAssistantTranscript(streamedAssistantText, assistantMessage.content);
      assistantMessage.content = mergedAssistantOutput;

      input.currentSession.messages.push(assistantMessage);
      input.currentSession.updatedAt = input.nowIso();
      const finalRows = buildFinalAssistantRows({
        rows: turn.rows,
        streamedAssistantText,
        committedStreamingText: streamState.committedStreamingText(),
        toolHeaders: streamState.toolHeaders(),
      });
      input.setRows((current) => [...finalizeToolProgressRows(current, pendingStreamRowId), ...finalRows]);
      // File tree may have changed during tool execution; refresh @path autocomplete candidates.
      invalidateRepoPathCandidates();
      input.currentSession.tokenUsage.push(turn.tokenEntry);
      input.setTokenUsage(() => [...input.currentSession.tokenUsage]);
      await input.persist();
    } catch (error) {
      const remoteTaskId = remoteTaskIdFromError(error);
      if (!isAbortError(error) && remoteTaskId) {
        const startedFollowup = await startRemoteTaskFollowup({
          client: input.client,
          remoteTaskId,
          setRows: input.setRows,
          setProgressText: input.setProgressText,
          persist: input.persist,
          stopWorking,
        });
        if (startedFollowup) {
          keepThinkingForRemoteTask = true;
          return;
        }
      }
      // Persist any partial assistant content so context isn't lost on timeout/error.
      const partialContent = streamState.streamedAssistantText().trim();
      if (partialContent.length > 0 && !isAbortError(error)) {
        const partialMessage = input.createMessage("assistant", partialContent);
        input.currentSession.messages.push(partialMessage);
        input.currentSession.updatedAt = input.nowIso();
        await input.persist().catch(() => {});
      }
      const errorContent = isAbortError(error) ? t("submit.interrupted") : formatSubmitError(error);
      input.setRows((current) => [
        ...current,
        createRow("system", errorContent, {
          dim: isAbortError(error),
          style: isAbortError(error) ? "cancelled" : "error",
        }),
      ]);
    } finally {
      streamState.clearStreamFlushTimer();
      input.setInterrupt(null);
      if (!keepThinkingForRemoteTask) {
        stopWorking();
        input.setProgressText(null);
      }
    }
  };
}
