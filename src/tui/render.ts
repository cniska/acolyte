import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { createElement as reactCreateElement, StrictMode } from "react";
import { setLogSink } from "../log";
import { DEFAULT_COLUMNS } from "./constants";
import { AppContext, InputContext, type InputContextValue, type InputRegistration } from "./context";
import { createElement } from "./dom";
import { setOnCommit } from "./host-config";
import { createInputDispatcher } from "./input";
import { reconciler } from "./reconciler";
import { serializeSplit, stripAnsiLength } from "./serialize";
import { ansi, kitty } from "./styles";

function clientLogPath(): string {
  return join(homedir(), ".acolyte", "client.log");
}

/** Count physical terminal rows, accounting for line wrapping. */
function physicalRowCount(output: string, columns: number): number {
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
  setLogSink(
    process.env.ACOLYTE_DEBUG
      ? (line) => {
          try {
            appendFileSync(clientLogPath(), line);
          } catch {
            // best-effort
          }
        }
      : () => {},
  );

  const root = createElement("tui-root", {});
  const stdout = process.stdout;
  const stdin = process.stdin;
  let lastActive = "";
  let lastActiveLineCount = 0;
  let flushedStaticCount = 0;
  // Number of logical lines (split by \n) frozen into scrollback. When the
  // active region overflows the terminal, top lines are written once and we
  // only re-render the bottom portion that fits on screen.
  let frozenLineCount = 0;
  let frozenOverflowText = "";
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

  if (stdout.isTTY) {
    stdout.write(kitty.enable(1));
    stdout.write(ansi.cursorHide);
    stdout.write(ansi.bracketedPasteEnable);
    stdout.write(ansi.focusReportEnable);
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

  function syncWrite(data: string) {
    if (stdout.isTTY) {
      // Trailing \r defuses auto-margin pending-wrap state left when a
      // line fills exactly `columns` characters.  Without it, the next
      // cursorUp may overshoot (pending-wrap counts as the next row in
      // some terminals), causing eraseSequence to eat into static content.
      stdout.write(`${ansi.syncStart}${data}\r${ansi.syncEnd}`);
    } else {
      stdout.write(data);
    }
  }

  /** Full-screen erase and re-render.  Called on terminal focus-in to
   *  repair display corruption caused by xterm resolving auto-margin
   *  pending-wrap state during tab switches.  Re-flushes static items
   *  (header, completed messages) because the erase may have cleared
   *  them from the visible area. */
  function forceRedraw() {
    if (exited || !stdout.isTTY) return;
    const { staticItems, active } = serializeSplit(root);
    const cols = stdout.columns ?? DEFAULT_COLUMNS;
    const rows = stdout.rows ?? 24;
    const maxLiveRows = rows - 1;

    // Move to top of visible area and erase everything.
    let buf = `${ansi.cursorUp(rows)}\r${ansi.eraseDown}`;
    for (const item of staticItems) buf += `${item}\n`;
    buf += active;

    syncWrite(buf);
    flushedStaticCount = staticItems.length;
    frozenLineCount = 0;
    frozenOverflowText = "";
    lastActive = active;
    lastActiveLineCount = Math.min(physicalRowCount(active, cols), maxLiveRows);
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
      if (frozenOverflowText.length > 0 && appendedStatic.startsWith(frozenOverflowText)) {
        appendedStatic = appendedStatic.slice(frozenOverflowText.length);
      }
      buf += appendedStatic;
      flushedStaticCount = staticItems.length;
      frozenLineCount = 0;
      frozenOverflowText = "";
      syncWrite(buf + active);
      lastActive = active;
      lastActiveLineCount = Math.min(countRows(active), maxLiveRows);
      return;
    }

    // Only re-render the active region if it changed.
    if (active === lastActive) return;

    const allLines = active.split("\n");

    // If content shrank (e.g. promotion removed rows), reset frozen state.
    if (allLines.length < frozenLineCount) {
      frozenLineCount = 0;
      frozenOverflowText = "";
    }

    // Determine the live (on-screen, erasable) portion of the active output.
    const liveLines = allLines.slice(frozenLineCount);

    // Count physical rows from the bottom to find what fits on screen.
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

    if (splitIdx === 0) {
      syncWrite(eraseSequence() + liveLines.join("\n"));
      lastActiveLineCount = physRows > 0 ? physRows - 1 : 0;
    } else {
      // Overflow: flush top lines to scrollback (they are stable during
      // streaming — content is append-only), then re-render only the
      // bottom portion that fits on screen.
      const overflow = liveLines.slice(0, splitIdx);
      const onScreen = liveLines.slice(splitIdx);
      frozenLineCount += splitIdx;
      const overflowText = overflow.join("\n");
      frozenOverflowText += `${overflowText}\n`;
      syncWrite(`${eraseSequence()}${overflowText}\n${onScreen.join("\n")}`);
      lastActiveLineCount = physRows > 0 ? physRows - 1 : 0;
    }

    lastActive = active;
  }

  setOnCommit(commitRender);

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
    setLogSink(null);
    setOnCommit(null);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("exit", onExit);
    if (stdin.isTTY) {
      stdin.removeListener("data", onStdinData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    if (stdout.isTTY) {
      stdout.write(ansi.focusReportDisable);
      stdout.write(ansi.bracketedPasteDisable);
      stdout.write(kitty.disable);
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
      stdout.write(kitty.disable);
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
