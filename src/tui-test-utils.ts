import type { ReactNode } from "react";
import { renderToString } from "./tui";
import { stripAnsi } from "./tui/serialize";

export const trimRightLines = (value: string): string =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

export function withTerminalWidth(width: number, run: () => string): string {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
  }
}

export function renderPlain(node: ReactNode, columns = 96): string {
  const rendered = withTerminalWidth(columns, () => renderToString(node));
  return trimRightLines(stripAnsi(rendered)).replace(/^\n+/, "").replace(/\n+$/, "");
}
