import { CodedError } from "./coded-error";
import { matchesDebugFlag, parseDebugFlags } from "./debug-flags";
import {
  CLOUD_ERROR_CODES,
  type ErrorCode,
  LIFECYCLE_ERROR_CODES,
  MEMORY_ERROR_CODES,
  TOOL_ERROR_CODES,
  TRANSPORT_ERROR_CODES,
} from "./error-contract";
import { type PlainTranslationKey, t } from "./i18n";

/**
 * Keyed by every error code, so a new code cannot compile until it decides what a user
 * who hits it at the CLI gets told. `null` means the thrown message is already written
 * for a person, either because a call site built it from a catalog string or because the
 * code only ever reaches the model.
 */
const FATAL_GUIDANCE: Record<ErrorCode, PlainTranslationKey | null> = {
  [CLOUD_ERROR_CODES.unauthorized]: "fatal.cloud.unauthorized",
  [CLOUD_ERROR_CODES.forbidden]: "fatal.cloud.forbidden",
  [CLOUD_ERROR_CODES.requestFailed]: "fatal.cloud.request_failed",
  [MEMORY_ERROR_CODES.embeddingUnavailable]: "fatal.memory.embedding_unavailable",
  [TRANSPORT_ERROR_CODES.daemonLost]: null,
  [LIFECYCLE_ERROR_CODES.timeout]: null,
  [LIFECYCLE_ERROR_CODES.fileNotFound]: null,
  [LIFECYCLE_ERROR_CODES.budgetExhausted]: null,
  [LIFECYCLE_ERROR_CODES.unknown]: null,
  [TOOL_ERROR_CODES.sandboxViolation]: null,
  [TOOL_ERROR_CODES.editFileMultiMatch]: null,
  [TOOL_ERROR_CODES.editFileFindNotFound]: null,
  [TOOL_ERROR_CODES.editCodeNoMatch]: null,
  [TOOL_ERROR_CODES.editCodeAmbiguousTarget]: null,
  [TOOL_ERROR_CODES.editCodeReplacementMetaMismatch]: null,
  [TOOL_ERROR_CODES.editCodeUnsupportedFile]: null,
  [TOOL_ERROR_CODES.searchFilesEmptyScope]: null,
  [TOOL_ERROR_CODES.searchFilesNoMatch]: null,
  [TOOL_ERROR_CODES.searchFilesUnsearchable]: null,
  [TOOL_ERROR_CODES.scanCodeUnsupportedFile]: null,
  [TOOL_ERROR_CODES.readFileTooLarge]: null,
  [TOOL_ERROR_CODES.readFileRangeInvalid]: null,
  [TOOL_ERROR_CODES.gitUnavailable]: null,
};

function guidanceFor(error: unknown): PlainTranslationKey | null {
  if (!(error instanceof CodedError)) return null;
  return Object.hasOwn(FATAL_GUIDANCE, error.code) ? FATAL_GUIDANCE[error.code as ErrorCode] : null;
}

/** The server body is unbounded text from outside the process, so it never becomes the headline. */
function debugDetail(error: CodedError): string {
  const body = (error.meta as { body?: unknown } | undefined)?.body;
  return typeof body === "string" && body.length > 0 ? `${error.message} [body: ${body}]` : error.message;
}

/**
 * Turns whatever reached the top of the CLI into lines a user can act on. The thrown
 * message names what failed; only the guidance table knows what to do about it, so when
 * a code has guidance the raw message steps aside and waits for `ACOLYTE_DEBUG=cli`.
 */
export function formatFatalError(error: unknown, options?: { debug?: boolean }): string[] {
  const guidance = guidanceFor(error);
  const lines: string[] = [];

  if (guidance && error instanceof CodedError) lines.push(`${t(guidance)} (${error.code})`);
  else if (error instanceof CodedError) lines.push(`${error.message} (${error.code})`);
  else if (error instanceof Error) lines.push(error.message);
  else lines.push(String(error));

  if (options?.debug) {
    if (guidance && error instanceof CodedError) lines.push(debugDetail(error));
    if (error instanceof Error && error.stack) lines.push(error.stack);
  }
  return lines;
}

export function fatalDebugEnabled(env: string | undefined): boolean {
  return matchesDebugFlag(parseDebugFlags(env), "cli");
}
