import { appConfig } from "./app-config";
import type { Backend } from "./backend";
import { createProgressTracker } from "./chat-progress";
import { type ChatRow, dispatchSlashCommand, type TokenUsageEntry } from "./chat-commands";
import { invalidateRepoPathCandidates } from "./chat-file-ref";
import { isKnownSlashToken, resolveSlashAlias } from "./chat-slash";
import {
  appendInputHistory,
  applyUserTurn,
  resolveReferencedFileContext,
  runAssistantTurn,
  unresolvedPathRows,
} from "./chat-turn";
import { addMemory } from "./memory";
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
  openClarifyPanel: (questions: string[], originalPrompt: string) => void;
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
  if (!(error instanceof Error)) {
    return "Request failed. Retry and check backend logs if it keeps failing.";
  }
  const message = error.message.trim();
  const lower = message.toLowerCase();
  if (lower.includes("insufficient_quota") || lower.includes("quota exceeded") || lower.includes("quota")) {
    return "Provider quota exceeded. Add billing/credits or switch model/provider.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Backend request timed out. Retry or reduce request scope.";
  }
  if (lower.includes("shell command execution is disabled in read mode")) {
    return "Write action blocked in read mode. Run /permissions write and retry.";
  }
  if (
    lower.includes("backend unavailable") ||
    lower.includes("connection refused") ||
    lower.includes("socket connection was closed unexpectedly")
  ) {
    return "Backend unavailable. Start the backend and retry.";
  }
  if (lower.includes("remote backend error")) {
    return message;
  }
  return message || "Request failed. Retry and check backend logs if it keeps failing.";
}

function isLikelyWritePrompt(text: string): boolean {
  return /\b(add|edit|modify|update|change|fix|insert|refactor|rewrite|rename|create|delete|implement|apply patch|write)\b/i.test(
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

type RememberScope = "user" | "project";

type NaturalRememberDirective = {
  scope: RememberScope;
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

async function distillMemoryNote(backend: Backend, content: string, model: string, sessionId: string): Promise<string> {
  const prompt = [
    "Rewrite this into one concise memory note for future collaboration.",
    "Rules: one sentence, concrete preference, no preamble, no quotes, no markdown.",
    "",
    `Input: ${content}`,
  ].join("\n");
  try {
    const response = await backend.reply({
      message: prompt,
      history: [],
      model,
      sessionId,
    });
    const line = response.output.split("\n").find((item) => item.trim().length > 0) ?? response.output;
    return cleanMemoryCandidate(line) || cleanMemoryCandidate(content);
  } catch {
    return cleanMemoryCandidate(content);
  }
}

export function resolveNaturalRememberDirective(text: string): NaturalRememberDirective | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const trailingProjectRememberThisMatch = trimmed.match(/^(.+?)(?:,\s*|\s+)remember this for project$/i);
  if (trailingProjectRememberThisMatch?.[1]) {
    return { scope: "project", content: trailingProjectRememberThisMatch[1].trim() };
  }
  const trailingUserRememberThisMatch = trimmed.match(/^(.+?)(?:,\s*|\s+)remember this(?: for user)?$/i);
  if (trailingUserRememberThisMatch?.[1]) {
    return { scope: "user", content: trailingUserRememberThisMatch[1].trim() };
  }
  const projectMatch = trimmed.match(/^remember this for project[:\s]+(.+)$/i);
  if (projectMatch?.[1]) {
    return { scope: "project", content: projectMatch[1].trim() };
  }
  const userMatch = trimmed.match(/^remember this(?: for user)?[:\s]+(.+)$/i);
  if (userMatch?.[1]) {
    return { scope: "user", content: userMatch[1].trim() };
  }
  const bareRememberMatch = trimmed.match(/^remember\s+(.+)$/i);
  if (bareRememberMatch?.[1]) {
    const content = bareRememberMatch[1].trim();
    if (/^this$/i.test(content)) {
      return null;
    }
    return { scope: "user", content };
  }
  const trailingRememberMatch = trimmed.match(/^(.+?)\s+remember$/i);
  if (trailingRememberMatch?.[1]) {
    return { scope: "user", content: trailingRememberMatch[1].trim() };
  }
  return null;
}

export function extractClarifyingQuestions(output: string): string[] {
  const lines = output.split("\n").map((line) => line.trim());
  const headingIndex = lines.findIndex((line) => /^(?:[-*]\s*)?clarifying questions\s*:?\s*$/i.test(line));
  if (headingIndex < 0) {
    return [];
  }
  const questions: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.length === 0) {
      if (questions.length > 0) {
        break;
      }
      continue;
    }
    const numbered = line.match(/^\d+[).]\s+(.+)$/);
    if (!numbered?.[1]) {
      if (questions.length > 0) {
        break;
      }
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
  if (!raw.startsWith(INTERNAL_CLARIFICATION_PREFIX)) {
    return null;
  }
  const payload = raw.slice(INTERNAL_CLARIFICATION_PREFIX.length);
  try {
    const parsed = JSON.parse(payload) as Partial<InternalClarificationTurn>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const originalPrompt = typeof parsed.originalPrompt === "string" ? parsed.originalPrompt.trim() : "";
    const answers = Array.isArray(parsed.answers)
      ? parsed.answers
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const question =
              typeof (item as { question?: unknown }).question === "string"
                ? (item as { question: string }).question.trim()
                : "";
            const answer =
              typeof (item as { answer?: unknown }).answer === "string"
                ? (item as { answer: string }).answer.trim()
                : "";
            if (!question || !answer) {
              return null;
            }
            return { question, answer };
          })
          .filter((item): item is ClarificationAnswer => Boolean(item))
      : [];
    if (!originalPrompt || answers.length === 0) {
      return null;
    }
    return { originalPrompt, answers };
  } catch {
    return null;
  }
}

function parseInternalWriteResumeTurn(raw: string): InternalWriteResumeTurn | null {
  if (!raw.startsWith(INTERNAL_WRITE_RESUME_PREFIX)) {
    return null;
  }
  const prompt = raw.slice(INTERNAL_WRITE_RESUME_PREFIX.length).trim();
  if (!prompt) {
    return null;
  }
  return { prompt };
}

function buildClarifiedUserText(turn: InternalClarificationTurn): string {
  const lines = turn.answers.map((item) => `- ${item.question}: ${item.answer}`);
  return `${turn.originalPrompt}\n\nClarifications:\n${lines.join("\n")}`;
}

function dedupeToolProgressRows(existing: ChatRow[], incoming: ChatRow[]): ChatRow[] {
  const seen = new Set(
    existing
      .filter((row) => row.style === "toolProgress")
      .map((row) => `${row.role}:${row.style}:${row.content.trim().toLowerCase()}`),
  );
  const out: ChatRow[] = [];
  for (const row of incoming) {
    if (row.style !== "toolProgress") {
      out.push(row);
      continue;
    }
    const key = `${row.role}:${row.style}:${row.content.trim().toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
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
    if (!text || (input.isThinking && !text.startsWith("/"))) {
      return;
    }
    if (!isInternalReplay && text.startsWith("/") && !text.includes(" ") && !isKnownSlashToken(text)) {
      return;
    }
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
      input.setThinkingLabel("Working…");
      try {
        const distilled = await distillMemoryNote(
          input.backend,
          naturalRememberDirective.content,
          appConfig.model,
          input.currentSession.id,
        );
        await addMemory(distilled, { scope: naturalRememberDirective.scope });
        const label = naturalRememberDirective.scope === "project" ? "project" : "user";
        const confirmation = `Saved ${label} memory: ${distilled}`;
        const assistant = input.createMessage("assistant", confirmation);
        input.currentSession.messages.push(assistant);
        input.currentSession.updatedAt = input.nowIso();
        input.setRows((current) => [
          ...current,
          { id: `row_${crypto.randomUUID()}`, role: "system", content: confirmation, dim: true },
        ]);
        await input.persist();
      } catch (error) {
        input.setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "system",
            content: error instanceof Error ? error.message : "Failed to save memory.",
            dim: true,
          },
        ]);
      } finally {
        input.setIsThinking(false);
        input.setThinkingLabel(null);
      }
      return;
    }
    if (!internalClarification && input.pendingPolicyCandidate && !text.startsWith("/")) {
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
    let userText = text;
    let runVerifyAfterReply = false;
    if (!isInternalReplay) {
      const commandResult = await dispatchSlashCommand({
        text,
        resolvedText: dispatchResolvedText,
        backend: input.backend,
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
        openResumePanel: input.openResumePanel,
        openPermissionsPanel: input.openPermissionsPanel,
        openPolicyPanel: input.openPolicyPanel,
        setBackendPermissionMode: input.backend.setPermissionMode,
        tokenUsage: input.tokenUsage,
      });
      if (commandResult.stop) {
        return;
      }
      if (!internalWriteResume && isLikelyWritePrompt(text)) {
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
      userText = commandResult.userText;
      runVerifyAfterReply = commandResult.runVerifyAfterReply;
    } else if (internalClarification) {
      userText = buildClarifiedUserText(internalClarification);
      runVerifyAfterReply = false;
    } else {
      userText = text;
      runVerifyAfterReply = false;
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
    if (unresolvedPaths.length > 0) {
      input.setRows((current) => [...current, ...unresolvedPathRows(unresolvedPaths)]);
    }
    if (unresolvedPaths.length > 0 && contexts.length === 0) {
      await input.persist();
      return;
    }

    input.setIsThinking(true);
    input.setThinkingLabel("Working…");
    const abortController = new AbortController();
    input.setInterrupt(() => abortController.abort());
    const thinkingStartedAt = Date.now();
    const progressTracker = createProgressTracker({
      onStatus: () => {},
      onTool: (message) => {
        input.setRows((current) => [
          ...current,
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: message,
            style: "toolProgress",
          },
        ]);
      },
      dedupeToolMessages: false,
    });
    const pollProgress = async (): Promise<void> => {
      const progress = await input.backend.progress(input.currentSession.id, progressTracker.afterSeq());
      if (!progress || progress.events.length === 0) {
        return;
      }
      progressTracker.apply(progress.events);
    };
    const progressPoll = setInterval(() => {
      void pollProgress().catch(() => {
        // Best-effort progress polling; ignore transient backend/proxy errors.
      });
    }, 150);
    await input.persist();

    try {
      const turn = await runAssistantTurn({
        backend: input.backend,
        userText,
        history: [...fileContextMessages, ...input.currentSession.messages],
        model: appConfig.model,
        sessionId: input.currentSession.id,
        signal: abortController.signal,
        runVerifyAfterReply,
        thinkingStartedAt,
        createMessage: input.createMessage,
      });
      const assistantMessage = turn.assistantMessage;
      // Ensure fast turns still surface tool/stage progress once before final rows.
      await pollProgress().catch(() => {});
      const clarifyingQuestions = extractClarifyingQuestions(assistantMessage.content);
      if (clarifyingQuestions.length > 0) {
        const nonAssistantRows = turn.rows.filter((row) => row.role !== "assistant");
        input.setRows((current) => {
          const deduped = dedupeToolProgressRows(current, nonAssistantRows);
          return [...current, ...deduped];
        });
        input.openClarifyPanel(clarifyingQuestions, text);
      } else {
        input.currentSession.messages.push(assistantMessage);
        input.currentSession.updatedAt = input.nowIso();
        input.setRows((current) => [...current, ...dedupeToolProgressRows(current, turn.rows)]);
      }
      // File tree may have changed during tool execution; refresh @path autocomplete candidates.
      invalidateRepoPathCandidates();
      input.currentSession.tokenUsage.push(turn.tokenEntry);
      input.setTokenUsage(() => [...input.currentSession.tokenUsage]);
      await input.persist();
    } catch (error) {
      const row: ChatRow = {
        id: `row_${crypto.randomUUID()}`,
        role: "system",
        content: isAbortError(error) ? "Interrupted." : formatSubmitError(error),
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
