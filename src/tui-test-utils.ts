import { createElement as h, type ReactNode } from "react";
import { renderToString } from "./tui";
import { createElement } from "./tui/dom";
import { setOnCommit } from "./tui/host-config";
import { reconciler } from "./tui/reconciler";
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

export function wait(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function renderHook<T>(hookFn: () => T): { result: { current: T }; unmount: () => void } {
  const result = {} as { current: T };
  function App() {
    result.current = hookFn();
    return h("tui-text", null, "");
  }
  const root = createElement("tui-root", {});
  setOnCommit(() => {});
  const container = reconciler.createContainer(
    root,
    0,
    null,
    false,
    null,
    "",
    (e: Error) => {
      throw e;
    },
    () => {},
    () => {},
    () => {},
  );
  reconciler.updateContainerSync(h(App), container, null, null);
  reconciler.flushSyncWork();
  reconciler.flushPassiveEffects();
  return {
    result,
    unmount() {
      reconciler.updateContainerSync(null, container, null, null);
      reconciler.flushSyncWork();
      setOnCommit(null);
    },
  };
}
