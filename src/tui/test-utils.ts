import { createElement as h, type ReactNode, useSyncExternalStore } from "react";
import { DEFAULT_TERMINAL_WIDTH } from "./constants";
import { createElement } from "./dom";
import { setOnCommit } from "./host-config";
import { renderToString } from "./index";
import { reconciler } from "./reconciler";
import { physicalRowCount } from "./render";
import { stripAnsi } from "./serialize";
import { ansi } from "./styles";
import { replayTerminal } from "./vt";

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
 * Install a mock TTY on `process.stdout` (isTTY + fixed columns/rows) that
 * captures every write into `writes`. Returns the capture buffer and a
 * `restore` that puts the real descriptors back.
 */
function mockTty(columns: number, rows: number): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
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
  return { writes, restore };
}

/**
 * Render a component into a mocked TTY and return all stdout writes.
 * The setup callback receives an `unmount` function for teardown timing.
 */
export async function renderCapture(
  setup: (ctx: { unmount: () => void }) => ReactNode,
  options: { columns?: number; rows?: number } = {},
): Promise<string[]> {
  const { writes, restore } = mockTty(options.columns ?? 120, options.rows ?? 24);
  try {
    const { render } = await import("./render");
    const app = render(setup({ unmount: () => app.unmount() }));
    await app.waitUntilExit();
  } finally {
    restore();
  }
  return writes;
}

/** Drop the unmount-cleanup writes (cursor-show onward) so only frames remain. */
export function frameWrites(writes: string[]): string[] {
  const cleanup = writes.findIndex((write) => write.includes(ansi.cursorShow));
  return cleanup >= 0 ? writes.slice(0, cleanup) : writes;
}

/** Force the reconciler to commit all pending work to the DOM, then drain the
 *  event loop so any scheduler-deferred commit lands too. */
async function settleReconciler(): Promise<void> {
  reconciler.flushSyncWork();
  reconciler.flushPassiveEffects();
  await new Promise((resolve) => setTimeout(resolve, 0));
  reconciler.flushSyncWork();
  reconciler.flushPassiveEffects();
}

/**
 * Deterministic frame driver: render each node in `script` as a discrete frame,
 * forcing a commit between steps via the renderer's `flush()` seam (no throttle
 * sleeps). Returns the stdout writes captured per frame — `frames[i]` is
 * everything written while `script[i]` was mounted.
 *
 * Frame 0 also carries the mount's setup escapes; subsequent frames carry only
 * that step's active-region re-render.
 */
export async function renderScript(
  script: ReactNode[],
  options: { columns?: number; rows?: number } = {},
): Promise<string[][]> {
  const { writes, restore } = mockTty(options.columns ?? 120, options.rows ?? 24);
  let index = 0;
  const listeners = new Set<() => void>();
  const store = {
    get: () => index,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    advance: () => {
      index += 1;
      for (const listener of listeners) listener();
    },
  };
  function Driver(): ReactNode {
    const i = useSyncExternalStore(store.subscribe, store.get);
    return script[i] ?? null;
  }
  const frames: string[][] = [];
  try {
    const { render } = await import("./render");
    const app = render(h(Driver));
    await settleReconciler();
    app.flush();
    frames.push(writes.splice(0));
    for (let i = 1; i < script.length; i++) {
      store.advance();
      await settleReconciler();
      app.flush();
      frames.push(writes.splice(0));
    }
    app.unmount();
    await app.waitUntilExit();
  } finally {
    restore();
  }
  return frames;
}

const CURSOR_ACCOUNTING_VT_ROWS = 4096;

export class CursorAccountingError extends Error {
  constructor(
    readonly frame: number,
    readonly emitted: number,
    readonly oracleRow: number,
    readonly renderRow: number,
  ) {
    super(
      `cursor-accounting violation at frame ${frame}\n` +
        `  emitted cursorUp: ${emitted}\n` +
        `  VT oracle (real column width): ${oracleRow}\n` +
        `  render physicalRowCount:       ${renderRow}`,
    );
    this.name = "CursorAccountingError";
  }
}

/**
 * Extract one frame's active-region re-render: the `cursorUp(n)` distance it
 * moves up before erasing, and the live content it then paints. Reads the last
 * synchronized-output block in the frame (the active render always follows any
 * static flush within a commit). Returns null when the frame did not re-render
 * the active region (no synchronized block — an unchanged commit).
 */
function parseActiveFrame(writes: string[]): { cursorUp: number; live: string } | null {
  const joined = writes.join("");
  const start = joined.lastIndexOf(ansi.syncStart);
  if (start < 0) return null;
  const afterStart = start + ansi.syncStart.length;
  const endIdx = joined.indexOf(ansi.syncEnd, afterStart);
  const block = endIdx >= 0 ? joined.slice(afterStart, endIdx) : joined.slice(afterStart);
  // syncWrite appends a trailing `\r` before syncEnd; drop it to recover `normalized`.
  let rest = block.endsWith("\r") ? block.slice(0, -1) : block;
  let cursorUp = 0;
  // eraseSequence is `cursorUp(n)\r eraseDown` (absent/empty when n was 0). Parse it
  // without a regex control-char literal: match CSI, then digits, then `A\r` + eraseDown.
  const csi = ansi.cursorUp(1).slice(0, 2); // "ESC["
  if (rest.startsWith(csi)) {
    let end = csi.length;
    for (let ch = rest[end]; ch !== undefined && ch >= "0" && ch <= "9"; ch = rest[end]) end += 1;
    const suffix = `A\r${ansi.eraseDown}`;
    if (end > csi.length && rest.slice(end, end + suffix.length) === suffix) {
      cursorUp = Number.parseInt(rest.slice(csi.length, end), 10);
      rest = rest.slice(end + suffix.length);
    }
  }
  return { cursorUp, live: rest };
}

/**
 * Assert every frame's `cursorUp(n)` equals the physical height of the PRIOR
 * frame's live region — the invariant a width miscalculation or a foreign write
 * violates. Cross-checks two independent measures: the width-aware VT (real
 * column arithmetic) and render's own `physicalRowCount`. A wide-char regression
 * in the erase math breaks the two apart and is caught here.
 *
 * Precondition: no frame overflows into scrollback (the emitted distance then
 * covers only the bottom slice, not the written content). Drive with a viewport
 * tall enough to hold the content; scrollback preservation is covered separately
 * by `assertTranscriptIntegrity`.
 */
export function assertCursorAccounting(frames: string[][], columns: number): void {
  let prevLive: string | null = null;
  frames.forEach((frame, i) => {
    const parsed = parseActiveFrame(frame);
    if (!parsed) return; // unchanged commit — nothing re-rendered this frame
    if (prevLive === null) {
      if (parsed.cursorUp !== 0) throw new CursorAccountingError(i, parsed.cursorUp, 0, 0);
    } else {
      const oracleRow = replayTerminal([prevLive], CURSOR_ACCOUNTING_VT_ROWS, columns).row;
      const renderRow = physicalRowCount(prevLive.replace(/\r/g, ""), columns);
      if (parsed.cursorUp !== oracleRow || parsed.cursorUp !== renderRow) {
        throw new CursorAccountingError(i, parsed.cursorUp, oracleRow, renderRow);
      }
    }
    prevLive = parsed.live;
  });
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
