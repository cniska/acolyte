import { appConfig } from "./app-config";
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
  openWriteConfirmPanel: (prompt: string) => void;
  pendingPolicyCandidate: PolicyCandidate | null;
  setPendingPolicyCandidate: (next: PolicyCandidate | null) => void;
  tokenUsage: TokenUsageEntry[];
  isThinking: boolean;
  setInputHistory: (updater: (current: string[]) => string[]) => void;
  setInputHistoryIndex: (next: number) => void;
  setInputHistoryDraft: (next: string) => void;
  setIsThinking: (next: boolean) => void;
  setThinkingLabel: (next: string | null) => void;
  setTokenUsage: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
  setInterrupt: (handler: (() => void) | null) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isLikelyWritePrompt(text: string): boolean {
  return /\b(edit|modify|update|change|refactor|rewrite|rename|create|delete|implement|apply patch|write)\b/i.test(
    text,
  );
}

function statusPermissionMode(status: string): "read" | "write" | null {
  const match = status.match(/\bpermission_mode=(read|write)\b/);
  if (!match) {
    return null;
  }
  return match[1] as "read" | "write";
}

function presentModelLabel(model: string): string {
  const prefixes = ["openai/", "openai-compatible/", "anthropic/", "gemini/", "google/"];
  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

export function resolveNaturalRememberCommand(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const projectMatch = trimmed.match(/^remember this for project[:\s]+(.+)$/i);
  if (projectMatch?.[1]) {
    return `/remember --project ${projectMatch[1].trim()}`;
  }
  const userMatch = trimmed.match(/^remember this(?: for user)?[:\s]+(.+)$/i);
  if (userMatch?.[1]) {
    return `/remember ${userMatch[1].trim()}`;
  }
  const bareRememberMatch = trimmed.match(/^remember\s+(.+)$/i);
  if (bareRememberMatch?.[1]) {
    const content = bareRememberMatch[1].trim();
    if (/^this$/i.test(content)) {
      return null;
    }
    return `/remember ${content}`;
  }
  const trailingRememberMatch = trimmed.match(/^(.+?)\s+remember$/i);
  if (trailingRememberMatch?.[1]) {
    return `/remember ${trailingRememberMatch[1].trim()}`;
  }
  return null;
}

export function createSubmitHandler(input: CreateSubmitHandlerInput): (raw: string) => Promise<void> {
  return async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || (input.isThinking && !text.startsWith("/"))) {
      return;
    }
    if (text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) {
      return;
    }
    const resolvedText = resolveSlashAlias(text);
    const naturalRememberCommand = resolveNaturalRememberCommand(text);
    const dispatchResolvedText = naturalRememberCommand ?? resolvedText;
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
      resolvedText: dispatchResolvedText,
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
      setBackendPermissionMode: input.backend.setPermissionMode,
      tokenUsage: input.tokenUsage,
    });
    if (commandResult.stop) {
      return;
    }
    if (isLikelyWritePrompt(text)) {
      try {
        const status = await input.backend.status();
        if (statusPermissionMode(status) === "read") {
          input.setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "system",
              content: "Write request needs confirmation in read mode.",
            },
          ]);
          input.openWriteConfirmPanel(text);
          return;
        }
      } catch {
        // Best-effort check; continue normally if status lookup fails.
      }
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
    input.setThinkingLabel(`Thinking… (${presentModelLabel(appConfig.models.main)})`);
    const abortController = new AbortController();
    input.setInterrupt(() => abortController.abort());
    const thinkingStartedAt = Date.now();
    let progressAfterSeq = 0;
    const progressPoll = setInterval(() => {
      void input.backend
        .progress(input.currentSession.id, progressAfterSeq)
        .then((progress) => {
          if (!progress || progress.events.length === 0) {
            return;
          }
          progressAfterSeq = progress.events[progress.events.length - 1]?.seq ?? progressAfterSeq;
          const latestMessage = progress.events[progress.events.length - 1]?.message?.trim();
          if (latestMessage) {
            input.setThinkingLabel(latestMessage);
          }
        })
        .catch(() => {
          // Best-effort progress polling; ignore transient backend/proxy errors.
        });
    }, 600);
    await input.persist();

    try {
      const turn = await runAssistantTurn({
        backend: input.backend,
        userText,
        history: [...fileContextMessages, ...input.currentSession.messages],
        model: appConfig.models.main,
        sessionId: input.currentSession.id,
        signal: abortController.signal,
        runVerifyAfterReply,
        thinkingStartedAt,
        createMessage: input.createMessage,
      });
      const assistantMessage = turn.assistantMessage;
      input.currentSession.messages.push(assistantMessage);
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
      clearInterval(progressPoll);
      input.setInterrupt(null);
      input.setIsThinking(false);
      input.setThinkingLabel(null);
    }
  };
}
