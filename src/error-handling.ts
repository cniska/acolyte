import type { z } from "zod";
import { CodedError } from "./coded-error";
import { ERROR_KINDS, type ErrorCode, type ErrorKind, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { domainIdSchema } from "./id-contract";
import type { StreamError } from "./stream-error";
import { extractToolErrorCode } from "./tool-error";

export type ErrorCategory = "timeout" | "file-not-found" | "budget-exhausted" | "other";
export type ErrorSource = "generate" | "tool-result" | "tool-error" | "server";
export type AppError<TCode extends string = string, TMeta = unknown> = CodedError<TCode, TMeta>;
export type ParsedError = { message: string; code?: string; kind?: string };
export type ParseErrorResult = { ok: true; value: ParsedError } | { ok: false; error: "invalid_error_payload" };
export type SerializedToolError = {
  error: {
    message: string;
    code?: string;
    kind?: string;
  };
};
export const ERROR_CATEGORIES = ["timeout", "file-not-found", "budget-exhausted", "other"] as const;
export const errorIdSchema = domainIdSchema("err");
export type ErrorId = z.infer<typeof errorIdSchema>;

export function createAppError<TCode extends string, TMeta = unknown>(
  code: TCode,
  message: string,
  meta?: TMeta,
): AppError<TCode, TMeta> {
  return new CodedError(code, message, meta !== undefined ? { meta } : undefined);
}

export function createErrorStats(initialValue = 0): Record<ErrorCategory, number> {
  return Object.fromEntries(ERROR_CATEGORIES.map((category) => [category, initialValue])) as Record<
    ErrorCategory,
    number
  >;
}

const ERROR_MAP: readonly { category: ErrorCategory; code: ErrorCode; kind: ErrorKind }[] = [
  { category: "timeout", code: LIFECYCLE_ERROR_CODES.timeout, kind: ERROR_KINDS.timeout },
  { category: "file-not-found", code: LIFECYCLE_ERROR_CODES.fileNotFound, kind: ERROR_KINDS.fileNotFound },
  { category: "budget-exhausted", code: LIFECYCLE_ERROR_CODES.budgetExhausted, kind: ERROR_KINDS.budgetExhausted },
  { category: "other", code: LIFECYCLE_ERROR_CODES.unknown, kind: ERROR_KINDS.unknown },
];

export function categoryFromErrorCode(code?: string): ErrorCategory | undefined {
  return ERROR_MAP.find((e) => e.code === code)?.category;
}

export function categoryFromErrorKind(kind?: string): ErrorCategory | undefined {
  return ERROR_MAP.find((e) => e.kind === kind)?.category;
}

export function errorKindFromCategory(category: ErrorCategory): ErrorKind {
  return ERROR_MAP.find((e) => e.category === category)?.kind ?? ERROR_KINDS.unknown;
}

export function errorCodeFromCategory(category: ErrorCategory): ErrorCode {
  return ERROR_MAP.find((e) => e.category === category)?.code ?? LIFECYCLE_ERROR_CODES.unknown;
}

export function parseError(value: unknown): ParseErrorResult {
  if (typeof value === "string") return { ok: true, value: parseMessageFields(value) };
  if (value instanceof Error) return { ok: true, value: parseErrorInstance(value) };
  if (typeof value === "object" && value !== null) return parseErrorObject(value);
  return { ok: false, error: "invalid_error_payload" };
}

export function serializeToolError(value: unknown): SerializedToolError {
  const parsed = parseError(value);
  if (!parsed.ok) return { error: { message: "Tool error" } };
  const { message, code, kind } = parsed.value;
  return {
    error: {
      message,
      ...(code ? { code } : {}),
      ...(kind ? { kind } : {}),
    },
  };
}

function parseMessageFields(message: string, overrides?: { code?: unknown; kind?: unknown }): ParsedError {
  return {
    message,
    code: typeof overrides?.code === "string" ? overrides.code : extractToolErrorCode(message),
    kind: typeof overrides?.kind === "string" ? overrides.kind : undefined,
  };
}

function parseErrorInstance(error: Error): ParsedError {
  return parseMessageFields(error.message, {
    code: "code" in error ? error.code : undefined,
    kind: "kind" in error ? error.kind : undefined,
  });
}

function parseErrorObject(value: object): ParseErrorResult {
  const rec = value as { message?: unknown; error?: unknown; code?: unknown; kind?: unknown };
  if (typeof rec.message === "string") return { ok: true, value: parseMessageFields(rec.message, rec) };
  if (typeof rec.error === "string") return { ok: true, value: parseMessageFields(rec.error, rec) };
  if (rec.error === undefined) return { ok: false, error: "invalid_error_payload" };
  const nested = parseError(rec.error);
  if (!nested.ok) return nested;
  return {
    ok: true,
    value: {
      ...nested.value,
      code: typeof rec.code === "string" ? rec.code : nested.value.code,
      kind: typeof rec.kind === "string" ? rec.kind : nested.value.kind,
    },
  };
}

export function createStreamError(input: {
  message: string;
  code?: string;
  kind?: string;
  source?: ErrorSource;
  tool?: string;
}): { errorCode: string; category: ErrorCategory; error: StreamError } {
  const kindCategory = categoryFromErrorKind(input.kind);
  const errorCode =
    input.code ??
    extractToolErrorCode(input.message) ??
    (kindCategory ? errorCodeFromCategory(kindCategory) : undefined) ??
    LIFECYCLE_ERROR_CODES.unknown;
  const category = categoryFromErrorCode(errorCode) ?? kindCategory ?? "other";
  const errorKind = input.kind ?? errorKindFromCategory(category);
  return {
    errorCode,
    category,
    error: {
      code: errorCode,
      category,
      kind: errorKind,
      source: input.source,
      tool: input.tool,
    },
  };
}
