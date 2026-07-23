import { dispatchSlashCommand } from "./chat-commands";
import type { ChatMessage } from "./chat-contract";
import { type ChatRow, createRow } from "./chat-contract";
import { invalidateRepoPathCandidates } from "./chat-file-ref";
import { formatSubmitError, isAbortError, resolveNaturalRememberDirective } from "./chat-message-handler-helpers";
import { createMessageStreamState } from "./chat-message-handler-stream";
import { startRemoteTaskFollowup } from "./chat-message-handler-task-followup";
import { addActiveSkill, removeActiveSkill } from "./chat-skill-activator";
import { isKnownSlashToken, suggestSlashCommands } from "./chat-slash";
import type { TranscriptRow } from "./chat-transcript-contract";
import {
  appendInputHistory,
  applyUserTurn,
  createAtReferenceSuggestion,
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
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setTranscriptPresentation?: (updater: (current: TranscriptRow[]) => TranscriptRow[]) => void;
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
  resumeTranscript: (session: Session) => void;
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

  let turnState: "idle" | "running" = "idle";
  const acquireTurn = (): boolean => {
    if (turnState !== "idle") return false;
    turnState = "running";
    return true;
  };
  const releaseTurn = (): void => {
    turnState = "idle";
  };

  const startAssistantTurn = async (userText: string): Promise<void> => {
    acquireTurn();
    log.debug("chat.turn.start", { userText });
    startPending();
    const userMessage = input.createMessage("user", userText);
    input.currentSession.messages.push(userMessage);
    input.currentSession.updatedAt = input.nowIso();
    const { suggestion: fileSuggestion, unresolvedPaths } = await createAtReferenceSuggestion(userText, {
      workspace: input.currentSession.workspace,
    });
    if (unresolvedPaths.length > 0) input.setRows((current) => [...current, ...unresolvedPathRows(unresolvedPaths)]);
    input.setPendingState({ kind: "running" });
    const controller = new AbortController();
    input.setInterrupt(() => controller.abort());
    const pendingStartedAt = Date.now();
    const runningToolCallIds = new Set<string>();
    const streamState = createMessageStreamState({
      setRows: input.setRows,
      setTranscriptPresentation: input.setTranscriptPresentation,
    });

    await input.persist();
    let cleanup: "full" | "none" = "full";

    try {
      const suggestions: string[] = [];
      if (fileSuggestion) suggestions.push(fileSuggestion);

      const turn = await runAssistantTurn({
        client: input.client,
        userText,
        history: input.currentSession.messages,
        model: input.currentSession.model,
        sessionId: input.currentSession.id,
        activeSkills: input.currentSession.activeSkills,
        suggestions,
        workspace: input.currentSession.workspace,
        signal: controller.signal,
        onEvent: (event) => {
          // Row projection goes through the single interpreter; this switch owns only
          // the TUI-local pending/usage indicators, which are not row mutations.
          streamState.onEvent(event);
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
              runningToolCallIds.add(event.toolCallId);
              input.setPendingState({ kind: "running", toolCalls: runningToolCallIds.size });
              break;
            case "skill-activated":
              addActiveSkill(input.currentSession, event.skill);
              break;
            case "skill-deactivated":
              removeActiveSkill(input.currentSession, event.name);
              break;
          }
        },
        pendingStartedAt,
        createMessage: input.createMessage,
      });
      const assistantMessage = turn.assistantMessage;
      streamState.finalize();

      if (turn.activeSkills) {
        input.currentSession.activeSkills = turn.activeSkills;
      }
      // A turn blocked on an empty answer has no model prose; don't persist a blank
      // assistant message — a textless bubble is noise, and the block reason is already
      // shown as the error row in the transcript.
      if (assistantMessage.content.trim().length > 0) {
        input.currentSession.messages.push(assistantMessage);
      }
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
      // The streamed rows are the authoritative display transcript: they carry the
      // turn's true interleaving (prose, tool, prose) and are already committed to the
      // screen. reply.output is the same prose reassembled for model history, so
      // re-committing it here only reshuffles prose below the tool rows and re-emits
      // content that may have scrolled into append-only scrollback — a duplicate.
      // Keep the streamed rows and append this turn's status/error rows. When `output`
      // was not streamed as deltas — a provider that returns output without them, or a
      // host-synthesized notice (a yield/stopped message injected after the stream ended) —
      // fall back to a bubble so the answer still shows.
      const fallbackRows =
        !turn.outputStreamed && assistantMessage.content.trim().length > 0
          ? [createRow("assistant", assistantMessage.content)]
          : [];
      input.setRows((current) => [...current, ...fallbackRows, ...turn.rows]);
      invalidateRepoPathCandidates();
      input.currentSession.tokenUsage.push(turn.tokenEntry);
      input.setTokenUsage(() => [...input.currentSession.tokenUsage]);
      // Clear running usage in the same synchronous batch as the committed
      // entry: the status line sums committed + running, so deferring this to
      // the finally block (past `await persist()`) would render one frame that
      // counts the finished turn twice.
      input.setRunningUsage(null);
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
          cleanup = "none";
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
            outcome: "cancelled",
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
      if (cleanup !== "none") {
        releaseTurn();
        input.setInterrupt(null);
        if (cleanup === "full") {
          stopPending();
          input.setPendingState(null);
        }
      }
    }
  };

  const handler = async (raw: string): Promise<void> => {
    const text = raw.trim();
    const busy = turnState === "running" || input.isPending;
    log.debug("chat.handler", { text, turnState, isPending: input.isPending });
    if (!text || (busy && !text.startsWith("/"))) return;
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
    if (!acquireTurn()) return;
    let userText = text;
    const commandResult = await dispatchSlashCommand({
      text,
      resolvedText: text,
      client: input.client,
      sessionState: input.sessionState,
      currentSession: input.currentSession,
      setCurrentSession: input.setCurrentSession,
      setTokenUsage: input.setTokenUsage,
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
      resumeTranscript: input.resumeTranscript,
      clearTranscript: input.clearTranscript,
    });
    log.debug("chat.command.result", { stop: commandResult.stop, userText: commandResult.userText });
    if (commandResult.stop) {
      releaseTurn();
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
