import { unreachable } from "./assert";
import { type AppError, createAppError } from "./error-handling";
import type { ModelProviderName } from "./provider-config";

export const USER_ERROR_MESSAGES = {
  noModelConfigured: "No model configured. Choose a model with /model.",
  noApiUrlConfigured: "No API URL configured. Start the server with: acolyte server",
} as const;

export type UserErrorCode =
  | "E_MODEL_NOT_CONFIGURED"
  | "E_MODEL_PROVIDER_UNAVAILABLE"
  | "E_CLIENT_API_URL_NOT_CONFIGURED";

type UserErrorMetaByCode = {
  E_MODEL_NOT_CONFIGURED: undefined;
  E_MODEL_PROVIDER_UNAVAILABLE: { model: string; provider: ModelProviderName };
  E_CLIENT_API_URL_NOT_CONFIGURED: undefined;
};

export type UserError<C extends UserErrorCode = UserErrorCode> = AppError<C, UserErrorMetaByCode[C]>;

function messageForUserError(code: UserErrorCode, meta?: UserErrorMetaByCode[UserErrorCode]): string {
  switch (code) {
    case "E_MODEL_NOT_CONFIGURED":
      return USER_ERROR_MESSAGES.noModelConfigured;
    case "E_CLIENT_API_URL_NOT_CONFIGURED":
      return USER_ERROR_MESSAGES.noApiUrlConfigured;
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
