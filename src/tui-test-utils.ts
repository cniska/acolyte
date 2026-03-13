import type { ReactNode } from "react";
import { renderToString } from "./tui";

export const stripAnsi = (value: string): string => {
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value[i] === "\u001b") {
      i++;
      if (i < value.length && value[i] === "[") {
        i++;
        while (i < value.length) {
          const code = value.charCodeAt(i);
          i++;
          if (code >= 0x40 && code <= 0x7e) break;
        }
      } else if (i < value.length) {
        i++;
      }
      continue;
    }
    out += value[i];
    i++;
  }
  return out;
};

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

export function renderInkPlain(node: ReactNode, columns = 96): string {
  const rendered = withTerminalWidth(columns, () => renderToString(node));
  return trimRightLines(stripAnsi(rendered)).replace(/^\n+/, "").replace(/\n+$/, "");
}
