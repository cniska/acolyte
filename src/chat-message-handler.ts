import { dispatchSlashCommand } from "./chat-commands";
import type { ChatMessage } from "./chat-contract";
import { type ChatRow, createRow } from "./chat-contract";
import { invalidateRepoPathCandidates } from "./chat-file-ref";
import { formatSubmitError, isAbortError, resolveNaturalRememberDirective } from "./chat-message-handler-helpers";
import { createMessageStreamState } from "./chat-message-handler-stream";
import { startRemoteTaskFollowup } from "./chat-message-handler-task-followup";
import { isKnownSlashToken, suggestSlashCommands } from "./chat-slash";
import {
  appendInputHistory,
  applyUserTurn,
  resolveReferencedFileContext,
  runAssistantTurn,
  unresolvedPathRows,
} from "./chat-turn";
import type { Client, PendingState } from "./client-contract";
import { t } from "./i18n";
import { log } from "./log";
import { addMemory } from "./memory-ops";
import { palette } from "./palette";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";

type CreateMessageHandlerInput = {
  client: Client;
  sessionState: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  toRows: (messages: ChatMessage[]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
  openResumePanel: () => void;
  openModelPanel: () => void | Promise<void>;
  tokenUsage: SessionTokenUsageEntry[];
  isPending: boolean;
  setInputHistory: (updater: (current: string[]) => string[]) => void;
  setInputHistoryIndex: (next: number) => void;
  setInputHistoryDraft: (next: string) => void;
  onStartPending?: () => void;
  onStopPending?: () => void;
  setPendingState: (next: PendingState | null) => void;
  setRunningUsage: (next: { inputTokens: number; outputTokens: number } | null) => void;
  setTokenUsage: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
  createMessage: (role: ChatMessage["role"], content: string) => ChatMessage;
  nowIso: () => string;
  setInterrupt: (handler: (() => void) | null) => void;
  useMemory?: boolean;
  promote?: () => void;
  clearTranscript: (sessionId?: string) => void;
};

function remoteTaskIdFromError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const taskId = (error as Error & { taskId?: unknown }).taskId;
  return typeof taskId === "string" && taskId.length > 0 ? taskId : null;
}

export function createMessageHandler(input: CreateMessageHandlerInput): {
  handleSubmit: (raw: string) => Promise<void>;
  startAssistantTurn: (userText: string) => Promise<void>;
} {
  const startPending = (): void => {
    input.onStartPending?.();
  };

  const stopPending = (): void => {
    input.onStopPending?.();
  };

  const startAssistantTurn = async (userText: string): Promise<void> => {
    log.debug("chat.turn.start", { userText });
    startPending();
    const userMessage = input.createMessage("user", userText);
    input.currentSession.messages.push(userMessage);
    input.currentSession.updatedAt = input.nowIso();
    const { contexts, unresolvedPaths } = await resolveReferencedFileContext(userText, {
      workspace: input.currentSession.workspace,
    });
    const fileContextMessages: ChatMessage[] = contexts.map((context) => input.createMessage("system", context));
    if (unresolvedPaths.length > 0) input.setRows((current) => [...current, ...unresolvedPathRows(unresolvedPaths)]);
    if (unresolvedPaths.length > 0 && contexts.length === 0) {
      stopPending();
      await input.persist();
      return;
    }
    input.setPendingState({ kind: "running" });
    const controller = new AbortController();
    input.setInterrupt(() => controller.abort());
    const pendingStartedAt = Date.now();
    const runningToolCallIds = new Set<string>();
    const streamState = createMessageStreamState({
      setRows: input.setRows,
    });

    await input.persist();
    let keepPendingForRemoteTask = false;

    try {
      const turn = await runAssistantTurn({
        client: input.client,
        userText,
        history: [...fileContextMessages, ...input.currentSession.messages],
        model: input.currentSession.model,
        sessionId: input.currentSession.id,
        activeSkill: input.currentSession.activeSkill,
        workspace: input.currentSession.workspace,
        useMemory: input.useMemory,
        signal: controller.signal,
        onEvent: (event) => {
          switch (event.type) {
            case "status":
              if (event.state.kind === "running") {
                input.setPendingState(
                  runningToolCallIds.size > 0
                    ? { kind: "running", toolCalls: runningToolCallIds.size }
                    : { kind: "running" },
                );
              } else {
                input.setPendingState(event.state);
              }
              break;
            case "usage":
              input.setRunningUsage({ inputTokens: event.inputTokens, outputTokens: event.outputTokens });
              break;
            case "tool-call":
              streamState.onToolCall();
              runningToolCallIds.add(event.toolCallId);
              input.setPendingState({ kind: "running", toolCalls: runningToolCallIds.size });
              break;
            case "text-delta":
              streamState.onDelta(event.text);
              break;
            case "tool-output":
              streamState.onOutput(event);
              break;
            case "tool-result":
              streamState.onToolResult(event);
              break;
            case "checklist":
              streamState.onChecklist(event);
              break;
            case "error":
              streamState.onProgressError(event.errorMessage);
              break;
          }
        },
        pendingStartedAt,
        createMessage: input.createMessage,
      });
      const assistantMessage = turn.assistantMessage;
      streamState.finalize();

      input.currentSession.messages.push(assistantMessage);
      for (const row of turn.rows) {
        if (row.kind === "status" && typeof row.content === "string") {
          const msg = input.createMessage("system", row.content);
          msg.kind = "status";
          input.currentSession.messages.push(msg);
        }
      }
      input.currentSession.updatedAt = input.nowIso();
      // Clear the pending indicator in the same synchronous block as
      // adding the worked/status rows so React batches them into one
      // commit — avoids a frame where both "Working" and "Worked" show.
      input.setPendingState(null);
      input.setRows((current) => [...current, ...turn.rows]);
      invalidateRepoPathCandidates();
      input.currentSession.tokenUsage.push(turn.tokenEntry);
      input.setTokenUsage(() => [...input.currentSession.tokenUsage]);
      await input.persist();
    } catch (error) {
      const remoteTaskId = remoteTaskIdFromError(error);
      if (!isAbortError(error) && remoteTaskId) {
        const followupController = new AbortController();
        const startedFollowup = await startRemoteTaskFollowup({
          client: input.client,
          remoteTaskId,
          setRows: input.setRows,
          setPendingState: input.setPendingState,
          persist: input.persist,
          onStopPending: stopPending,
          signal: followupController.signal,
        });
        if (startedFollowup) {
          input.setInterrupt(() => followupController.abort());
          keepPendingForRemoteTask = true;
          return;
        }
      }
      const partialContent = streamState.streamedText().trim();
      if (partialContent.length > 0) {
        const partialMessage = input.createMessage("assistant", partialContent);
        input.currentSession.messages.push(partialMessage);
        input.currentSession.updatedAt = input.nowIso();
        await input.persist().catch(() => {});
      } else if (isAbortError(error)) {
        // No assistant content was generated — remove the orphaned user
        // message so the model doesn't try to answer it on the next turn.
        const idx = input.currentSession.messages.lastIndexOf(userMessage);
        if (idx >= 0) input.currentSession.messages.splice(idx, 1);
      }
      if (isAbortError(error)) {
        streamState.finalize();
        input.setRows((current) => [
          ...current,
          createRow("task", t("chat.submit.interrupted"), {
            dim: true,
            marker: palette.cancelled,
          }),
        ]);
      } else {
        streamState.dispose();
        input.setRows((current) => [
          ...current,
          createRow("system", formatSubmitError(error), { text: palette.error }),
        ]);
      }
    } finally {
      if (!keepPendingForRemoteTask) {
        input.setInterrupt(null);
        stopPending();
        input.setPendingState(null);
      }
    }
  };

  const handler = async (raw: string): Promise<void> => {
    const text = raw.trim();
    log.debug("chat.handler", { text, isPending: input.isPending });
    if (!text || (input.isPending && !text.startsWith("/"))) return;
    if (text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) {
      const corrections = suggestSlashCommands(text);
      if (corrections.length === 1) return handler(corrections[0]);
      input.setRows((current) => [...current, createRow("system", t("chat.command.unknown", { command: text }))]);
      return;
    }
    const naturalRememberDirective = resolveNaturalRememberDirective(text);
    input.setInputHistory((current) => appendInputHistory(current, text));
    input.setInputHistoryIndex(-1);
    input.setInputHistoryDraft("");
    input.setValue("");

    if (text === "?") {
      input.setShowHelp((current) => !current);
      return;
    }
    if (naturalRememberDirective) {
      const userMessage = input.createMessage("user", text);
      input.currentSession.messages.push(userMessage);
      input.currentSession.updatedAt = input.nowIso();
      const { row: userRow } = applyUserTurn({
        session: input.currentSession,
        displayText: text,
      });
      input.setRows((current) => [...current, userRow]);
      startPending();
      input.setPendingState({ kind: "running" });
      try {
        const distilled = naturalRememberDirective.content
          .trim()
          .replace(/^[-*]\s+/, "")
          .replace(/^["'`]|["'`]$/g, "")
          .replace(/^memory\s*[:-]\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();
        await addMemory(distilled, { scope: naturalRememberDirective.scope });
        const label = naturalRememberDirective.scope === "project" ? "project" : "user";
        const confirmation = t("chat.remember.saved", { scope: label, content: distilled });
        const assistant = input.createMessage("assistant", confirmation);
        input.currentSession.messages.push(assistant);
        input.currentSession.updatedAt = input.nowIso();
        input.setRows((current) => [...current, createRow("system", confirmation, { dim: true })]);
        await input.persist();
      } catch (error) {
        input.setRows((current) => [
          ...current,
          createRow("system", error instanceof Error ? error.message : t("chat.remember.failed"), { dim: true }),
        ]);
      } finally {
        stopPending();
        input.setPendingState(null);
      }
      return;
    }
    if (text.startsWith("/")) {
      input.setRows((current) => [...current, createRow("user", text)]);
    }
    let userText = text;
    const commandResult = await dispatchSlashCommand({
      text,
      resolvedText: text,
      client: input.client,
      sessionState: input.sessionState,
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
      startAssistantTurn,
      openResumePanel: input.openResumePanel,
      openModelPanel: input.openModelPanel,
      tokenUsage: input.tokenUsage,
      clearTranscript: input.clearTranscript,
    });
    log.debug("chat.command.result", { stop: commandResult.stop, userText: commandResult.userText });
    if (commandResult.stop) {
      input.promote?.();
      return;
    }
    userText = commandResult.userText;
    const { row: userRow } = applyUserTurn({
      session: input.currentSession,
      displayText: text,
    });
    input.setRows((current) => [...current, userRow]);
    await startAssistantTurn(userText);
  };
  return { handleSubmit: handler, startAssistantTurn };
}
