import { unreachable } from "./assert";
import { type AppError, createAppError } from "./error-handling";
import { t } from "./i18n";
import { isLoopbackHost } from "./network-host";
import type { Provider } from "./provider-contract";

export type UserErrorCode = "E_MODEL_NOT_CONFIGURED" | "E_MODEL_PROVIDER_UNAVAILABLE";

type UserErrorMetaByCode = {
  E_MODEL_NOT_CONFIGURED: undefined;
  E_MODEL_PROVIDER_UNAVAILABLE: { model: string; provider: Provider };
};

export type UserError<C extends UserErrorCode = UserErrorCode> = AppError<C, UserErrorMetaByCode[C]>;

function messageForUserError(code: UserErrorCode, meta?: UserErrorMetaByCode[UserErrorCode]): string {
  switch (code) {
    case "E_MODEL_NOT_CONFIGURED":
      return t("error.model.not_configured");
    case "E_MODEL_PROVIDER_UNAVAILABLE": {
      const typedMeta = meta as UserErrorMetaByCode["E_MODEL_PROVIDER_UNAVAILABLE"];
      const providerKey = {
        openai: "error.model.provider_unavailable.openai",
        anthropic: "error.model.provider_unavailable.anthropic",
        google: "error.model.provider_unavailable.google",
      } as const;
      const key = providerKey[typedMeta.provider] ?? undefined;
      if (key) return t(key, { model: typedMeta.model });
      return t("error.model.provider_unavailable", { model: typedMeta.model });
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
    message: () => t("error.prompt.quota_exceeded"),
  },
  {
    matches: (lower) => lower.includes("timed out") || lower.includes("timeout"),
    message: () => t("error.prompt.server_timed_out"),
  },
  {
    matches: (lower) =>
      lower.includes("server unavailable") ||
      lower.includes("connection refused") ||
      lower.includes("socket connection was closed unexpectedly"),
    message: () => t("error.prompt.server_unavailable"),
  },
  {
    matches: (lower) => lower.includes("remote server error"),
    message: (trimmed) => trimmed,
  },
];

export function mapQuotaErrorMessage(message: string): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  if (isQuotaErrorMessage(lower)) return t("error.prompt.quota_exceeded");
  return message;
}

export function formatPromptError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return t("error.prompt.request_failed");
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
    if (loopback && parsed.protocol === "https:") return t("error.connection.loopback_https", { url: apiUrl });
    if (loopback) return t("error.connection.loopback_default", { url: apiUrl });
  } catch {
    // Fall through to generic guidance for malformed URLs.
  }
  return t("error.connection.generic", { url: apiUrl });
}
