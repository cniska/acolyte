import type { PermissionMode } from "./config-contract";
import { formatPromptError, USER_ERROR_MESSAGES } from "./error-messages";
import type { MemoryScope } from "./memory";
import type { StatusFields } from "./status-contract";

export type NaturalRememberDirective = {
  scope: MemoryScope;
  content: string;
};

const INTERNAL_WRITE_RESUME_PREFIX = "\u0000acolyte_write_resume:";

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  const message = error.message.toLowerCase();
  return message.includes("request aborted") || message.includes("aborted");
}

export function formatSubmitError(error: unknown): string {
  if (!(error instanceof Error)) return USER_ERROR_MESSAGES.requestFailed;
  return formatPromptError(error.message);
}

export function isLikelyWritePrompt(text: string): boolean {
  return /\b(add|edit|modify|update|change|fix|insert|refactor|rewrite|rename|create|delete|implement|apply patch|write)\b/i.test(
    text,
  );
}

export function statusPermissionMode(status: StatusFields): PermissionMode | null {
  const mode = status.permissions;
  if (mode === "read" || mode === "write") return mode;
  return null;
}

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

export function distillMemoryCandidate(content: string): string {
  return cleanMemoryCandidate(content);
}

export function buildInternalWriteResumeTurn(prompt: string): string {
  return `${INTERNAL_WRITE_RESUME_PREFIX}${prompt}`;
}

type InternalWriteResumeTurn = {
  prompt: string;
};

export function parseInternalWriteResumeTurn(raw: string): InternalWriteResumeTurn | null {
  if (!raw.startsWith(INTERNAL_WRITE_RESUME_PREFIX)) return null;
  const prompt = raw.slice(INTERNAL_WRITE_RESUME_PREFIX.length).trim();
  if (!prompt) return null;
  return { prompt };
}

export function mergeAssistantTranscript(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput.length === 0) return streamed;
  if (finalOutput === streamed) return finalOutput;
  if (finalOutput.startsWith(streamed)) return finalOutput;
  if (streamed.startsWith(finalOutput)) return streamed;
  const maxOverlap = Math.min(streamed.length, finalOutput.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (streamed.endsWith(finalOutput.slice(0, overlap))) return streamed + finalOutput.slice(overlap);
  }
  return streamed;
}
