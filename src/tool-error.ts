import type { ErrorKind, ToolRecovery } from "./error-primitives";

export class ToolError extends Error {
  code: string;
  kind?: ErrorKind;
  recovery?: ToolRecovery;

  constructor(code: string, message: string, kind?: ErrorKind, recovery?: ToolRecovery) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.kind = kind;
    this.recovery = recovery;
  }
}

export function createToolError(code: string, message: string, kind?: ErrorKind, recovery?: ToolRecovery): ToolError {
  return new ToolError(code, message, kind, recovery);
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
