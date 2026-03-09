import { formatPromptError, USER_ERROR_MESSAGES } from "./error-messages";
import type { MemoryScope } from "./memory";

export type NaturalRememberDirective = {
  scope: MemoryScope;
  content: string;
};

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
