import { unreachable } from "./assert";
import { type AppError, createAppError } from "./error-handling";
import type { ModelProviderName } from "./provider-config";

export const USER_ERROR_MESSAGES = {
  noModelConfigured: "No model configured. Choose a model with /model.",
  providerQuotaExceeded: "Provider quota exceeded. Add billing/credits or switch model/provider.",
  requestFailed: "Request failed. Retry and check server logs if it keeps failing.",
  serverTimedOut: "Server request timed out. Retry or reduce request scope.",
  writeBlockedInReadMode: "Write action blocked in read mode. Run /permissions write and retry.",
  serverUnavailable: "Server unavailable. Start the server and retry.",
} as const;

const CONNECTION_HELP_MESSAGES = {
  loopbackHttps: (apiUrl: string) =>
    `Cannot reach server at ${apiUrl}. Local daemon uses http:// (not https://); update apiUrl or run an HTTPS server.`,
  loopbackDefault: (apiUrl: string) => `Cannot reach server at ${apiUrl}. Start it with: acolyte server start`,
  generic: (apiUrl: string) => `Cannot reach server at ${apiUrl}. Check apiUrl and server availability.`,
} as const;

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export type UserErrorCode = "E_MODEL_NOT_CONFIGURED" | "E_MODEL_PROVIDER_UNAVAILABLE";

type UserErrorMetaByCode = {
  E_MODEL_NOT_CONFIGURED: undefined;
  E_MODEL_PROVIDER_UNAVAILABLE: { model: string; provider: ModelProviderName };
};

export type UserError<C extends UserErrorCode = UserErrorCode> = AppError<C, UserErrorMetaByCode[C]>;

function messageForUserError(code: UserErrorCode, meta?: UserErrorMetaByCode[UserErrorCode]): string {
  switch (code) {
    case "E_MODEL_NOT_CONFIGURED":
      return USER_ERROR_MESSAGES.noModelConfigured;
    case "E_MODEL_PROVIDER_UNAVAILABLE": {
      const typedMeta = meta as UserErrorMetaByCode["E_MODEL_PROVIDER_UNAVAILABLE"];
      if (typedMeta.provider === "openai") {
        return `Model "${typedMeta.model}" is unavailable. Set OPENAI_API_KEY (or configure an OpenAI-compatible base URL) and try again.`;
      }
      if (typedMeta.provider === "anthropic") {
        return `Model "${typedMeta.model}" is unavailable. Set ANTHROPIC_API_KEY and try again.`;
      }
      if (typedMeta.provider === "gemini") {
        return `Model "${typedMeta.model}" is unavailable. Set GOOGLE_API_KEY and try again.`;
      }
      return `Model "${typedMeta.model}" is unavailable. Check provider credentials and try again.`;
    }
    default:
      return unreachable(code);
  }
}

export function createUserError<C extends UserErrorCode>(code: C, meta?: UserErrorMetaByCode[C]): UserError<C> {
  return createAppError(code, messageForUserError(code, meta), meta);
}

export function mapQuotaMessage(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("insufficient_quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("exceeded your current quota")
  )
    return USER_ERROR_MESSAGES.providerQuotaExceeded;
  return message;
}

export function formatPromptErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return USER_ERROR_MESSAGES.requestFailed;
  const lower = trimmed.toLowerCase();
  if (mapQuotaMessage(trimmed) === USER_ERROR_MESSAGES.providerQuotaExceeded)
    return USER_ERROR_MESSAGES.providerQuotaExceeded;
  if (lower.includes("timed out") || lower.includes("timeout")) return USER_ERROR_MESSAGES.serverTimedOut;
  if (lower.includes("shell command execution is disabled in read mode"))
    return USER_ERROR_MESSAGES.writeBlockedInReadMode;
  if (
    lower.includes("server unavailable") ||
    lower.includes("connection refused") ||
    lower.includes("socket connection was closed unexpectedly")
  ) {
    return USER_ERROR_MESSAGES.serverUnavailable;
  }
  if (lower.includes("remote server error")) return trimmed;
  return trimmed;
}

export function connectionHelpMessage(apiUrl: string): string {
  try {
    const parsed = new URL(apiUrl);
    const loopback = isLoopbackHost(parsed.hostname);
    if (loopback && parsed.protocol === "https:") {
      return CONNECTION_HELP_MESSAGES.loopbackHttps(apiUrl);
    }
    if (loopback) {
      return CONNECTION_HELP_MESSAGES.loopbackDefault(apiUrl);
    }
  } catch {
    // Fall through to generic guidance for malformed URLs.
  }
  return CONNECTION_HELP_MESSAGES.generic(apiUrl);
}
