import { formatPromptError } from "./error-messages";
import { t } from "./i18n";

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function formatSubmitError(error: unknown): string {
  if (!(error instanceof Error)) return t("error.prompt.request_failed");
  return formatPromptError(error.message);
}
