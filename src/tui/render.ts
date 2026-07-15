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

type RenderOptions = {
  /** Policy for an otherwise-unhandled error. Passing it opts into process-level
   *  `uncaughtException`/`unhandledRejection` handlers that restore the terminal
   *  before invoking this — so error text never lands on a live TUI. Callers that
   *  omit it (tests) install nothing. The callback owns printing and process exit;
   *  since `process.exit` skips `finally`, it must also run any crash-critical
   *  teardown (e.g. releasing the session lock). */
  onFatalError?: (error: unknown) => void;
};

export function render(node: ReactNode, options: RenderOptions = {}): RenderInstance {
  const { onFatalError } = options;
  const root = createElement("tui-root", {});
  const stdout = process.stdout;
  const stdin = process.stdin;
  const termProgram = process.env.TERM_PROGRAM ?? "";
  const useKittyProtocol = stdout.isTTY && KITTY_TERMINALS.includes(termProgram);
  let lastActive = "";
  let lastActiveLineCount = 0;
  let paintForced = false;
  // Rows of a stale tail copy left by a width-change repaint (which must skip its
  // erase). Repaid by the next same-width erase so the copy doesn't dangle forever.
  let staleTailRows = 0;
  // Debt armed by the width guard but not yet owed: the first paint at the new
  // width is the one that strands the copy, so only that paint activates it.
  let pendingStaleRows = 0;
  // A change since the last frame means the terminal may have reflowed the tail.
  let lastRenderColumns = stdout.columns ?? DEFAULT_COLUMNS;
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
      // Frozen state and erase geometry are reconciled in commitRender, which
      // must own it anyway to catch a streaming commit landing mid-resize.
      paintForced = true;
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
    const distance = lastActiveLineCount + staleTailRows;
    if (!stdout.isTTY || distance <= 0) return "";
    return `${ansi.cursorUp(distance)}\r${ansi.eraseDown}`;
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

  /** Repaint the active region on focus-in. Frozen scrollback is left intact —
   *  it physically scrolled off and the erase can't reach it, so re-emitting would
   *  duplicate. The forced flag repaints the live tail only. */
  function forceRedraw() {
    if (exited || !stdout.isTTY) return;
    paintForced = true;
    commitRender();
  }

  function commitRender() {
    if (exited) return;
    const cols = stdout.columns ?? DEFAULT_COLUMNS;
    const { staticItems, active } = serializeSplit(root, cols);
    const maxLiveRows = (stdout.rows ?? 24) - 1;
    const forced = paintForced;
    paintForced = false;

    // Erasing with a stale count is transcript loss. On a width change the terminal
    // may reflow the tail, so cursor-up would overshoot into promoted scrollback —
    // skip the erase. Terminals only reflow soft-wrapped rows and every row we write
    // is hard-broken, so when each previous tail line fits both widths its height is
    // reflow-invariant and the skipped distance stays exact: carry it as debt and
    // repay it on the next same-width erase instead of leaving the copy dangling.
    // On a height shrink, clamp so cursor-up can't reach through the viewport top
    // into frozen history.
    if (cols !== lastRenderColumns) {
      const minCols = Math.min(cols, lastRenderColumns);
      const prevTail = lastActive.split("\n").slice(frozenLineCount);
      pendingStaleRows =
        lastActiveLineCount > 0 && prevTail.every((line) => stripAnsiLength(line) <= minCols) ? lastActiveLineCount : 0;
      staleTailRows = 0;
      lastActiveLineCount = 0;
      lastRenderColumns = cols;
    } else {
      if (lastActiveLineCount + staleTailRows > maxLiveRows) staleTailRows = 0;
      if (lastActiveLineCount > maxLiveRows) lastActiveLineCount = maxLiveRows;
    }

    // Flush any new static items (write-once scrollback).
    if (staticItems.length > flushedStaticCount) {
      let appendedStatic = "";
      for (let i = flushedStaticCount; i < staticItems.length; i++) {
        appendedStatic += `${staticItems[i]}\n`;
      }
      // When an overflowing active turn is promoted to static, its top lines are
      // already frozen in scrollback — they scrolled off and eraseSequence() can
      // only reach the live tail, so re-emitting them duplicates. Adopt the frozen
      // prefix: write only the delta below it. A rendering mismatch (prefix no
      // longer matches) falls back to the full write, no worse than before.
      if (frozenLineCount > 0) {
        const frozenPrefix = `${frozenScrollbackText}\n`;
        if (appendedStatic.startsWith(frozenPrefix)) {
          appendedStatic = appendedStatic.slice(frozenPrefix.length);
        }
      }
      const buf = eraseSequence() + appendedStatic;
      flushedStaticCount = staticItems.length;
      frozenLineCount = 0;
      frozenScrollbackText = "";
      syncWrite(buf);
      lastActive = "";
      lastActiveLineCount = 0;
      // Any stale copy now sits above the flushed static lines — unreachable.
      staleTailRows = 0;
      pendingStaleRows = 0;
    }

    // Only re-render the active region if it changed.
    if (active === lastActive && !forced) return;

    const allLines = active.split("\n");

    // Frozen lines scrolled into append-only scrollback; eraseSequence() cannot reach
    // them. When the frozen prefix no longer matches — an edit above the fold, or a
    // wholesale replacement — those lines are stale but immutable, so re-emitting them
    // just paints a second copy below the first. Rebase the frozen boundary on the
    // current content's fold and repaint the reachable tail alone: content that now
    // fits the viewport repaints in full, content that still overflows keeps a stale
    // (never duplicated) prefix in scrollback.
    if (frozenLineCount > 0 && allLines.slice(0, frozenLineCount).join("\n") !== frozenScrollbackText) {
      let rows = 0;
      let fold = 0;
      for (let i = allLines.length - 1; i >= 0; i--) {
        const lineRows = linePhysRows(allLines[i] ?? "", cols);
        if (rows + lineRows > maxLiveRows) {
          fold = i + 1;
          break;
        }
        rows += lineRows;
      }
      // Keep the last line live — it may still be streaming, and the split loop below
      // needs a non-empty tail to anchor the erase distance.
      frozenLineCount = Math.min(fold, allLines.length - 1);
      frozenScrollbackText = allLines.slice(0, frozenLineCount).join("\n");
    }

    const erase = eraseSequence();
    staleTailRows = 0;
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
    // Never freeze the last live line — it may still be streaming. It then owns the
    // tail alone, so its height is the erase distance even when it overruns the
    // viewport (the clamp on the next paint caps the reach at what stayed visible).
    if (splitIdx > 0 && splitIdx === liveLines.length) {
      splitIdx = liveLines.length - 1;
      physRows = linePhysRows(liveLines[splitIdx] ?? "", cols);
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
    staleTailRows = pendingStaleRows;
    pendingStaleRows = 0;
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
      onFatal(error);
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
    process.removeListener("uncaughtException", onFatal);
    process.removeListener("unhandledRejection", onFatal);
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

  // Restore the terminal before the error reaches the app's policy, so no error text
  // ever lands on a live TUI. exit() is idempotent, so a later 'exit' fire is a no-op.
  function onFatal(error: unknown) {
    exit();
    onFatalError?.(error);
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", onExit);
  if (onFatalError) {
    process.on("uncaughtException", onFatal);
    process.on("unhandledRejection", onFatal);
  }

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
