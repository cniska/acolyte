import type { ReactNode } from "react";
import { createElement as reactCreateElement } from "react";
import { AppContext, InputContext, type InputContextValue, type InputRegistration } from "./context";
import { createElement } from "./dom";
import { setOnCommit } from "./host-config";
import { createInputDispatcher } from "./input";
import { reconciler } from "./reconciler";
import { serializeSplit, stripAnsiLength } from "./serialize";
import { ansi, kitty } from "./styles";

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
  const root = createElement("tui-root", {});
  const stdout = process.stdout;
  const stdin = process.stdin;
  let lastActive = "";
  let lastActiveLineCount = 0;
  let flushedStaticCount = 0;
  // Content that has scrolled into the terminal's scrollback buffer and can no
  // longer be erased. During streaming the active region can grow beyond the
  // terminal height; the overflow is written once and tracked here so we never
  // attempt to rewrite it.
  let frozenPrefix = "";
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

  const onStdinData = (data: Buffer | string) => {
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
  }

  function countRows(output: string): number {
    const cols = stdout.columns ?? 120;
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

  function commitRender() {
    if (exited) return;
    const { staticItems, active } = serializeSplit(root);
    const cols = stdout.columns ?? 120;
    const maxLiveRows = (stdout.rows ?? 24) - 1;

    // Flush any new static items (write-once scrollback).
    if (staticItems.length > flushedStaticCount) {
      let buf = eraseSequence();
      for (let i = flushedStaticCount; i < staticItems.length; i++) {
        buf += `${staticItems[i]}\n`;
      }
      flushedStaticCount = staticItems.length;
      frozenPrefix = "";
      stdout.write(buf + active);
      lastActive = active;
      lastActiveLineCount = Math.min(countRows(active), maxLiveRows);
      return;
    }

    // Only re-render the active region if it changed.
    if (active === lastActive) return;

    // If the frozen prefix no longer matches, reset it (e.g. after graduation).
    if (frozenPrefix.length > 0 && !active.startsWith(frozenPrefix)) {
      frozenPrefix = "";
    }

    // Determine the live (on-screen, erasable) portion of the active output.
    const livePart = active.slice(frozenPrefix.length);
    const liveLines = livePart.split("\n");

    // Count physical rows from the bottom to find what fits on screen.
    let physRows = 0;
    let splitIdx = 0;
    for (let i = liveLines.length - 1; i >= 0; i--) {
      const rows = linePhysRows(liveLines[i]!, cols);
      if (physRows + rows > maxLiveRows) {
        splitIdx = i + 1;
        break;
      }
      physRows += rows;
    }

    if (splitIdx === 0) {
      // Everything fits on screen — normal erase + rewrite.
      stdout.write(eraseSequence() + livePart);
      lastActiveLineCount = physRows > 0 ? physRows - 1 : 0;
    } else {
      // Overflow: freeze lines that won't fit, write them once to scrollback.
      const toFreeze = liveLines.slice(0, splitIdx);
      const onScreen = liveLines.slice(splitIdx);
      const freezeStr = `${toFreeze.join("\n")}\n`;
      frozenPrefix += freezeStr;
      stdout.write(eraseSequence() + freezeStr + onScreen.join("\n"));
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
    AppContext.Provider,
    { value: { exit } },
    reactCreateElement(InputContext.Provider, { value: inputContextValue }, node),
  );

  reconciler.updateContainer(wrappedNode, container, null, () => {});

  function cleanup() {
    setOnCommit(null);
    if (stdin.isTTY) {
      stdin.removeListener("data", onStdinData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    if (stdout.isTTY) {
      stdout.write(kitty.disable);
      stdout.write(ansi.cursorShow);
      stdout.write("\n");
    }
    reconciler.updateContainer(null, container, null, () => {});
  }

  return {
    waitUntilExit: () => exitPromise,
    unmount() {
      exit();
    },
  };
}
