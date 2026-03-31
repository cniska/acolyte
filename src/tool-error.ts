import { CodedError } from "./coded-error";
import type { ErrorKind } from "./error-contract";

export class ToolError extends CodedError<string, undefined, ErrorKind> {
  constructor(code: string, message: string, kind?: ErrorKind) {
    super(code, message, kind ? { kind } : undefined);
    this.name = "ToolError";
  }
}

export function createToolError(code: string, message: string, kind?: ErrorKind): ToolError {
  return new ToolError(code, message, kind);
}

export function encodeToolError(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function hasToolErrorCode(message: string, code: string): boolean {
  return message.includes(`[${code}]`);
}

export function extractToolErrorCode(message: string): string | undefined {
  const match = message.match(/\[([A-Z0-9_]+)\]/);
  return match?.[1];
}
