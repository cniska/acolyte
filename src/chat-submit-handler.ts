import type { Backend } from "./backend";
import { type ChatRow, dispatchSlashCommand, type TokenUsageEntry } from "./chat-commands";
import { isKnownSlashToken, resolveSlashAlias } from "./chat-slash";
import {
  appendInputHistory,
  applyUserTurn,
  resolveReferencedFileContext,
  runAssistantTurn,
  unresolvedPathRows,
} from "./chat-turn";
import type { PolicyCandidate } from "./policy-distill";
import type { Message, Session, SessionStore } from "./types";

type CreateSubmitHandlerInput = {
  backend: Backend;
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
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openPolicyPanel: (items: PolicyCandidate[]) => void;
  pendingPolicyCandidate: PolicyCandidate | null;
  setPendingPolicyCandidate: (next: PolicyCandidate | null) => void;
  tokenUsage: TokenUsageEntry[];
  isThinking: boolean;
  setInputHistory: (updater: (current: string[]) => string[]) => void;
  setInputHistoryIndex: (next: number) => void;
  setInputHistoryDraft: (next: string) => void;
  setIsThinking: (next: boolean) => void;
  setTokenUsage: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
  setInterrupt: (handler: (() => void) | null) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createSubmitHandler(input: CreateSubmitHandlerInput): (raw: string) => Promise<void> {
  return async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || input.isThinking) {
      return;
    }
    if (text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) {
      return;
    }
    const resolvedText = resolveSlashAlias(text);
    input.setInputHistory((current) => appendInputHistory(current, text));
    input.setInputHistoryIndex(-1);
    input.setInputHistoryDraft("");
    input.setValue("");

    if (resolvedText === "?") {
      input.setShowShortcuts((current) => !current);
      return;
    }
    if (input.pendingPolicyCandidate && !text.startsWith("/")) {
      const [head, ...rest] = text.split(/\s+/);
      const note = rest.join(" ").trim();
      const decision = head.toLowerCase();
      if (decision === "yes") {
        const noteSuffix = note ? ` | note: ${note}` : "";
        input.setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: `Policy draft confirmed: ${input.pendingPolicyCandidate?.normalized}${noteSuffix}`,
          },
        ]);
        input.setPendingPolicyCandidate(null);
        await input.persist();
        return;
      }
      if (decision === "no") {
        const noteSuffix = note ? ` | note: ${note}` : "";
        input.setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: `Policy draft skipped.${noteSuffix}`,
          },
        ]);
        input.setPendingPolicyCandidate(null);
        await input.persist();
        return;
      }
    }
    const commandResult = await dispatchSlashCommand({
      text,
      resolvedText,
      backend: input.backend,
      store: input.store,
      currentSession: input.currentSession,
      setCurrentSession: input.setCurrentSession,
      toRows: (messages) => input.toRows(messages),
      setRows: input.setRows,
      setShowShortcuts: input.setShowShortcuts,
      setValue: input.setValue,
      persist: input.persist,
      exit: input.exit,
      openSkillsPanel: input.openSkillsPanel,
      openResumePanel: input.openResumePanel,
      openPermissionsPanel: input.openPermissionsPanel,
      openPolicyPanel: input.openPolicyPanel,
      tokenUsage: input.tokenUsage,
    });
    if (commandResult.stop) {
      return;
    }
    const userText = commandResult.userText;
    const runVerifyAfterReply = commandResult.runVerifyAfterReply;

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
    if (unresolvedPaths.length > 0) {
      input.setRows((current) => [...current, ...unresolvedPathRows(unresolvedPaths)]);
    }
    if (unresolvedPaths.length > 0 && contexts.length === 0) {
      await input.persist();
      return;
    }

    input.setIsThinking(true);
    const abortController = new AbortController();
    input.setInterrupt(() => abortController.abort());
    const thinkingStartedAt = Date.now();
    await input.persist();

    try {
      const turn = await runAssistantTurn({
        backend: input.backend,
        userText,
        history: [...fileContextMessages, ...input.currentSession.messages],
        model: input.currentSession.model,
        sessionId: input.currentSession.id,
        signal: abortController.signal,
        runVerifyAfterReply,
        thinkingStartedAt,
        createMessage: input.createMessage,
      });
      const assistantMessage = turn.assistantMessage;
      input.currentSession.messages.push(assistantMessage);
      input.currentSession.model = turn.model;
      input.currentSession.updatedAt = input.nowIso();
      input.setRows((current) => [...current, ...turn.rows]);
      input.setTokenUsage((current) => [...current, turn.tokenEntry]);
      await input.persist();
    } catch (error) {
      const row: ChatRow = {
        id: `row_${crypto.randomUUID()}`,
        role: "system",
        content: isAbortError(error) ? "Interrupted." : error instanceof Error ? error.message : "Unknown error",
        dim: isAbortError(error),
      };
      input.setRows((current) => [...current, row]);
    } finally {
      input.setInterrupt(null);
      input.setIsThinking(false);
    }
  };
}
