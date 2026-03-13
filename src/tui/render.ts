import type { ReactNode } from "react";
import { createElement as reactCreateElement } from "react";
import { AppContext, InputContext, type InputContextValue, type InputRegistration } from "./context";
import { createElement } from "./dom";
import { setOnCommit } from "./host-config";
import { createInputDispatcher } from "./input";
import { reconciler } from "./reconciler";
import { serialize } from "./serialize";
import { ansi, kitty } from "./styles";

type KittyKeyboardOptions = {
  mode?: "enabled" | "disabled";
  flags?: string[];
};

type RenderOptions = {
  exitOnCtrlC?: boolean;
  kittyKeyboard?: KittyKeyboardOptions;
};

type RenderInstance = {
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
};

export function render(node: ReactNode, options?: RenderOptions): RenderInstance {
  const root = createElement("tui-root", {});
  const stdout = process.stdout;
  const stdin = process.stdin;
  let lastOutput = "";
  let lastLineCount = 0;
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
    if (options?.exitOnCtrlC !== false) {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      if (raw === "\x03") {
        exit();
        return;
      }
    }
    dispatcher.dispatch(data);
  };

  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onStdinData);
  }

  const kittyFlags = options?.kittyKeyboard?.mode === "enabled" ? 1 : 0;
  if (kittyFlags > 0) {
    stdout.write(kitty.enable(kittyFlags));
  }

  stdout.write(ansi.cursorHide);

  function commitRender() {
    if (exited) return;
    const output = serialize(root);
    if (output === lastOutput) return;

    if (lastLineCount > 0) {
      stdout.write(ansi.cursorUp(lastLineCount));
    }
    stdout.write(`\r${ansi.eraseDown}`);
    stdout.write(output);

    lastOutput = output;
    lastLineCount = output.split("\n").length - 1;
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
    if (kittyFlags > 0) {
      stdout.write(kitty.disable);
    }
    stdout.write(ansi.cursorShow);
    stdout.write("\n");
    reconciler.updateContainer(null, container, null, () => {});
  }

  return {
    waitUntilExit: () => exitPromise,
    unmount() {
      exit();
    },
  };
}
