import type { ReactNode } from "react";
import { createElement as reactCreateElement, StrictMode } from "react";
import { DEFAULT_COLUMNS } from "./constants";
import { AppContext, InputContext, type InputContextValue, type InputRegistration } from "./context";
import { createElement } from "./dom";
import { setOnCommit } from "./host-config";
import { createInputDispatcher } from "./input";
import { reconciler } from "./reconciler";
import { serializeSplit, stripAnsiLength } from "./serialize";
import { ansi, kitty } from "./styles";

const KITTY_TERMINALS = ["kitty", "WezTerm", "ghostty", "iTerm.app"];

/** Count physical terminal rows, accounting for line wrapping. */
export function physicalRowCount(output: string, columns: number): number {
  const lines = output.split("\n");
  let rows = 0;
  for (const line of lines) {
    const visible = stripAnsiLength(line);
    rows += visible === 0 ? 1 : Math.ceil(visible / columns);
  }
  // Subtract 1: cursor stays on the last row, we only need to move up to the first.
  return rows - 1;
}

type RenderInstance = {
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
};

export function render(node: ReactNode): RenderInstance {
  const root = createElement("tui-root", {});
  const stdout = process.stdout;
  const stdin = process.stdin;
  const termProgram = process.env.TERM_PROGRAM ?? "";
  const useKittyProtocol = stdout.isTTY && KITTY_TERMINALS.includes(termProgram);
  let lastActive = "";
  let lastActiveLineCount = 0;
  let flushedStaticCount = 0;
  let exitResolve: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  let exited = false;

  const exit = () => {
    if (exited) return;
    exited = true;
    cleanup();
    exitResolve?.();
  };

  const dispatcher = createInputDispatcher();

  const inputContextValue: InputContextValue = {
    register(reg: InputRegistration) {
      const entry = { handler: reg.handler, isActive: reg.isActive };
      dispatcher.handlers.add(entry);
      return () => {
        dispatcher.handlers.delete(entry);
      };
    },
  };

  const FOCUS_IN = "\x1b[I";

  const onStdinData = (data: Buffer | string) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    if (raw.includes(FOCUS_IN)) {
      forceRedraw();
    }
    dispatcher.dispatch(data);
  };

  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onStdinData);
  }

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      lastActive = "";
      commitRender();
    }, 16);
  };

  if (stdout.isTTY) {
    if (useKittyProtocol) stdout.write(kitty.enable(1));
    stdout.write(ansi.cursorHide);
    stdout.write(ansi.bracketedPasteEnable);
    stdout.write(ansi.focusReportEnable);
    stdout.on("resize", onResize);
  }

  function countRows(output: string): number {
    const cols = stdout.columns ?? DEFAULT_COLUMNS;
    return physicalRowCount(output, cols);
  }

  function eraseSequence(): string {
    if (!stdout.isTTY || lastActiveLineCount <= 0) return "";
    return `${ansi.cursorUp(lastActiveLineCount)}\r${ansi.eraseDown}`;
  }

  function linePhysRows(line: string, cols: number): number {
    const visible = stripAnsiLength(line);
    return visible === 0 ? 1 : Math.ceil(visible / cols);
  }

  const useSyncOutput = stdout.isTTY && !process.env.TMUX;

  function syncWrite(data: string) {
    if (!stdout.isTTY) {
      stdout.write(data);
      return;
    }
    const normalized = data.replace(/\r?\n/g, "\r\n");
    // Trailing \r defuses auto-margin pending-wrap state left when a
    // line fills exactly `columns` characters.  Without it, the next
    // cursorUp may overshoot (pending-wrap counts as the next row in
    // some terminals), causing eraseSequence to eat into static content.
    if (useSyncOutput) {
      stdout.write(`${ansi.syncStart}${normalized}\r${ansi.syncEnd}`);
    } else {
      stdout.write(`${normalized}\r`);
    }
  }

  /** Repaint the active region on focus-in. */
  function forceRedraw() {
    if (exited || !stdout.isTTY) return;
    lastActive = "";
    commitRender();
  }

  function commitRender() {
    if (exited) return;
    const { staticItems, active } = serializeSplit(root);
    const cols = stdout.columns ?? DEFAULT_COLUMNS;
    const maxLiveRows = (stdout.rows ?? 24) - 1;

    // Flush any new static items (write-once scrollback).
    if (staticItems.length > flushedStaticCount) {
      let buf = eraseSequence();
      let appendedStatic = "";
      for (let i = flushedStaticCount; i < staticItems.length; i++) {
        appendedStatic += `${staticItems[i]}\n`;
      }
      buf += appendedStatic;
      flushedStaticCount = staticItems.length;
      const nextActiveLineCount = Math.min(countRows(active), maxLiveRows);
      syncWrite(buf + active);
      lastActive = active;
      lastActiveLineCount = nextActiveLineCount;
      return;
    }

    // Only re-render the active region if it changed.
    if (active === lastActive) return;

    const allLines = active.split("\n");
    const erase = eraseSequence();

    // Find the bottom-fitting slice: walk from the last line upward until
    // physRows would exceed maxLiveRows, then render only those lines.
    // Overflow lines above the split are not emitted — they are lost from
    // the active region (static content should already be in scrollback via
    // tui-static; the active region should not grow unboundedly).
    let physRows = 0;
    let splitIdx = 0;
    for (let i = allLines.length - 1; i >= 0; i--) {
      const rows = linePhysRows(allLines[i] ?? "", cols);
      if (physRows + rows > maxLiveRows) {
        splitIdx = i + 1;
        break;
      }
      physRows += rows;
    }

    syncWrite(erase + allLines.slice(splitIdx).join("\n"));
    lastActiveLineCount = physRows > 0 ? physRows - 1 : 0;
    lastActive = active;
  }

  const RENDER_THROTTLE_MS = 32;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let renderPending = false;

  function throttledCommitRender() {
    if (renderTimer) {
      renderPending = true;
      return;
    }
    commitRender();
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (renderPending) {
        renderPending = false;
        commitRender();
      }
    }, RENDER_THROTTLE_MS);
  }

  setOnCommit(throttledCommitRender);

  const container = reconciler.createContainer(
    root,
    0,
    null,
    false,
    null,
    "",
    (error: Error) => {
      console.error(error);
    },
    () => {},
    () => {},
    () => {},
  );

  const wrappedNode = reactCreateElement(
    StrictMode,
    null,
    reactCreateElement(
      AppContext.Provider,
      { value: { exit } },
      reactCreateElement(InputContext.Provider, { value: inputContextValue }, node),
    ),
  );

  reconciler.updateContainer(wrappedNode, container, null, () => {});

  function cleanup() {
    setOnCommit(null);
    if (resizeTimer) clearTimeout(resizeTimer);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("exit", onExit);
    if (stdin.isTTY) {
      stdin.removeListener("data", onStdinData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    if (stdout.isTTY) {
      stdout.removeListener("resize", onResize);
      stdout.write(ansi.focusReportDisable);
      stdout.write(ansi.bracketedPasteDisable);
      if (useKittyProtocol) stdout.write(kitty.disable);
      stdout.write(ansi.cursorShow);
      stdout.write("\n");
    }
    reconciler.updateContainer(null, container, null, () => {});
  }

  function onSignal() {
    exit();
    process.exit();
  }
  function onExit() {
    if (exited) return;
    // Synchronous cleanup on exit — restore terminal state.
    if (stdout.isTTY) {
      stdout.write(ansi.focusReportDisable);
      stdout.write(ansi.bracketedPasteDisable);
      if (useKittyProtocol) stdout.write(kitty.disable);
      stdout.write(ansi.cursorShow);
      stdout.write("\n");
    }
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", onExit);

  return {
    waitUntilExit: () => exitPromise,
    unmount() {
      exit();
    },
  };
}
