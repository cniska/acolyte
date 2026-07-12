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
  /** Force any pending throttled render to commit immediately. Test seam. */
  flush: () => void;
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
  // Lines from the active region that have already been written to scrollback.
  // Lets us emit only the delta on subsequent frames instead of re-emitting.
  let frozenLineCount = 0;
  let frozenScrollbackText = "";
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
      frozenLineCount = 0;
      frozenScrollbackText = "";
      lastActive = "";
      lastActiveLineCount = 0;
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
    frozenLineCount = 0;
    frozenScrollbackText = "";
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
      frozenLineCount = 0;
      frozenScrollbackText = "";
      syncWrite(buf);
      lastActive = "";
      lastActiveLineCount = 0;
    }

    // Only re-render the active region if it changed.
    if (active === lastActive) return;

    const allLines = active.split("\n");

    // If frozen lines no longer match the current active prefix (non-append-only
    // change), invalidate the frozen state so we repaint from scratch.
    if (frozenLineCount > 0 && allLines.slice(0, frozenLineCount).join("\n") !== frozenScrollbackText) {
      frozenLineCount = 0;
      frozenScrollbackText = "";
    }

    const erase = eraseSequence();
    const liveLines = allLines.slice(frozenLineCount);

    let physRows = 0;
    let splitIdx = 0;
    for (let i = liveLines.length - 1; i >= 0; i--) {
      const rows = linePhysRows(liveLines[i] ?? "", cols);
      if (physRows + rows > maxLiveRows) {
        splitIdx = i + 1;
        break;
      }
      physRows += rows;
    }
    // Never freeze the last live line — it may still be streaming.
    if (splitIdx > 0 && splitIdx === liveLines.length) {
      splitIdx = liveLines.length - 1;
    }

    if (splitIdx > 0) {
      // Write overflow + bottom-fitting slice atomically. The overflow lines scroll
      // into terminal scrollback naturally as the write pushes past the viewport top.
      const overflowLines = liveLines.slice(0, splitIdx);
      frozenLineCount += splitIdx;
      frozenScrollbackText = allLines.slice(0, frozenLineCount).join("\n");
      syncWrite(`${erase}${overflowLines.join("\n")}\n${liveLines.slice(splitIdx).join("\n")}`);
    } else {
      syncWrite(erase + liveLines.join("\n"));
    }
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
    flush() {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      commitRender();
    },
  };
}
