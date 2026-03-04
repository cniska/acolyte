import { unreachable } from "./assert";
import { type AppError, createAppError } from "./error-handling";
import { isLoopbackHost } from "./network-host";
import type { Provider } from "./provider-contract";

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

export type UserErrorCode = "E_MODEL_NOT_CONFIGURED" | "E_MODEL_PROVIDER_UNAVAILABLE";

type UserErrorMetaByCode = {
  E_MODEL_NOT_CONFIGURED: undefined;
  E_MODEL_PROVIDER_UNAVAILABLE: { model: string; provider: Provider };
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

type PromptErrorRule = {
  matches: (lower: string) => boolean;
  message: (trimmed: string) => string;
};

function isQuotaErrorMessage(lower: string): boolean {
  return (
    lower.includes("insufficient_quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("exceeded your current quota")
  );
}

const PROMPT_ERROR_RULES: readonly PromptErrorRule[] = [
  {
    matches: isQuotaErrorMessage,
    message: () => USER_ERROR_MESSAGES.providerQuotaExceeded,
  },
  {
    matches: (lower) => lower.includes("timed out") || lower.includes("timeout"),
    message: () => USER_ERROR_MESSAGES.serverTimedOut,
  },
  {
    matches: (lower) => lower.includes("shell command execution is disabled in read mode"),
    message: () => USER_ERROR_MESSAGES.writeBlockedInReadMode,
  },
  {
    matches: (lower) =>
      lower.includes("server unavailable") ||
      lower.includes("connection refused") ||
      lower.includes("socket connection was closed unexpectedly"),
    message: () => USER_ERROR_MESSAGES.serverUnavailable,
  },
  {
    matches: (lower) => lower.includes("remote server error"),
    message: (trimmed) => trimmed,
  },
];

export function mapQuotaErrorMessage(message: string): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  if (isQuotaErrorMessage(lower)) return USER_ERROR_MESSAGES.providerQuotaExceeded;
  return message;
}

export function formatPromptError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return USER_ERROR_MESSAGES.requestFailed;
  const lower = trimmed.toLowerCase();
  for (const rule of PROMPT_ERROR_RULES) {
    if (rule.matches(lower)) return rule.message(trimmed);
  }
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
