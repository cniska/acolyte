import { createElement as h, type ReactNode } from "react";
import { DEFAULT_TERMINAL_WIDTH } from "./constants";
import { createElement } from "./dom";
import { setOnCommit } from "./host-config";
import { renderToString } from "./index";
import { reconciler } from "./reconciler";
import { stripAnsi } from "./serialize";

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

export function renderPlain(node: ReactNode, columns = DEFAULT_TERMINAL_WIDTH): string {
  const rendered = withTerminalWidth(columns, () => renderToString(node));
  return trimRightLines(stripAnsi(rendered)).replace(/^\n+/, "").replace(/\n+$/, "");
}

export function wait(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render a component into a mocked TTY and return all stdout writes.
 * The setup callback receives an `unmount` function for teardown timing.
 */
export async function renderCapture(
  setup: (ctx: { unmount: () => void }) => ReactNode,
  options: { columns?: number; rows?: number } = {},
): Promise<string[]> {
  const writes: string[] = [];
  const columns = options.columns ?? 120;
  const rows = options.rows ?? 24;
  const saved = {
    write: process.stdout.write,
    isTTY: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    columns: Object.getOwnPropertyDescriptor(process.stdout, "columns"),
    rows: Object.getOwnPropertyDescriptor(process.stdout, "rows"),
  };
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
  process.stdout.write = ((data: string) => {
    writes.push(data);
    return true;
  }) as typeof process.stdout.write;
  const restore = () => {
    process.stdout.write = saved.write;
    for (const key of ["isTTY", "columns", "rows"] as const)
      if (saved[key]) Object.defineProperty(process.stdout, key, saved[key]);
  };
  try {
    const { render } = await import("./render");
    const app = render(setup({ unmount: () => app.unmount() }));
    await app.waitUntilExit();
  } finally {
    restore();
  }
  return writes;
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
