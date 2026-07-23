import { afterEach, describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import {
  createInputController,
  type InputControllerState,
  type InputEditAction,
  reduceInput,
} from "./input-controller";
import { PromptInputHandler } from "./prompt-input";
import { InputContext, type InputContextValue, type InputHandler, type KeyEvent } from "./tui/context";
import { createElement } from "./tui/dom";
import { setOnCommit } from "./tui/host-config";
import { emptyKey } from "./tui/input";
import { reconciler } from "./tui/reconciler";

type PressKey = Partial<KeyEvent>;

type Harness = {
  press: (input: string, key?: PressKey) => void;
  state: () => InputControllerState;
  actions: InputEditAction[];
  pastes: boolean[];
  cursorLines: number[];
  submits: string[];
  unmount: () => void;
};

/** Mount the headless PromptInputHandler in controlled mode, capture the handler
 *  the useInput effect registers, and run the real controlled loop: each emitted
 *  action is reduced into the state and fed back as props, mirroring chat-state. */
function mountControlled(initial = "", options: { wrapWidth?: number } = {}): Harness {
  let current = createInputController(initial);
  const actions: InputEditAction[] = [];
  const pastes: boolean[] = [];
  const cursorLines: number[] = [];
  const submits: string[] = [];
  let handler: InputHandler | null = null;
  const ctx: InputContextValue = {
    register: (reg) => {
      handler = reg.handler;
      return () => {
        handler = null;
      };
    },
  };

  const tree = () =>
    h(
      InputContext.Provider,
      { value: ctx },
      h(PromptInputHandler, {
        value: current.text,
        cursor: current.cursor,
        wrapWidth: options.wrapWidth,
        onAction: (action: InputEditAction, fromPaste: boolean) => {
          actions.push(action);
          pastes.push(fromPaste);
          current = reduceInput(current, action);
        },
        onSubmit: (value: string) => submits.push(value),
        onCursorLine: (line: number) => cursorLines.push(line),
      }),
    );

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
  const flush = () => {
    reconciler.updateContainerSync(tree(), container, null, null);
    reconciler.flushSyncWork();
    reconciler.flushPassiveEffects();
  };
  flush();

  return {
    press(input, key) {
      handler?.(input, { ...emptyKey(), ...key });
      flush();
    },
    state: () => current,
    actions,
    pastes,
    cursorLines,
    submits,
    unmount() {
      reconciler.updateContainerSync(null, container, null, null);
      reconciler.flushSyncWork();
      setOnCommit(null);
    },
  };
}

let active: Harness | null = null;
const mount = (initial?: string, options?: { wrapWidth?: number }): Harness => {
  active = mountControlled(initial, options);
  return active;
};
afterEach(() => {
  active?.unmount();
  active = null;
});

describe("PromptInputHandler: text entry", () => {
  test("insert keystrokes build up the controlled state", () => {
    const h = mount();
    h.press("h");
    h.press("i");
    expect(h.state()).toEqual({ text: "hi", cursor: 2 });
    expect(h.actions).toEqual([
      { kind: "insert", text: "h" },
      { kind: "insert", text: "i" },
    ]);
    expect(h.pastes).toEqual([false, false]);
  });

  test("insert splices at the cursor rather than appending", () => {
    const h = mount("ac");
    h.press("", { leftArrow: true });
    h.press("b");
    expect(h.state()).toEqual({ text: "abc", cursor: 2 });
  });

  test("a pasted insert carries the fromPaste flag", () => {
    const h = mount();
    h.press("x", { paste: true });
    expect(h.actions).toEqual([{ kind: "insert", text: "x" }]);
    expect(h.pastes).toEqual([true]);
  });

  test("each keystroke reports the cursor's line index", () => {
    const h = mount();
    h.press("a");
    h.press("b");
    expect(h.cursorLines).toEqual([0, 0]);
  });
});

describe("PromptInputHandler: help swallow", () => {
  test("a lone '?' on an empty prompt is swallowed", () => {
    const h = mount();
    h.press("?");
    expect(h.actions).toEqual([]);
    expect(h.state()).toEqual({ text: "", cursor: 0 });
  });

  test("'?' inserts once the prompt is non-empty", () => {
    const h = mount("a");
    h.press("?");
    expect(h.state()).toEqual({ text: "a?", cursor: 2 });
  });

  test("a pasted '?' on an empty prompt is not swallowed", () => {
    const h = mount();
    h.press("?", { paste: true });
    expect(h.state()).toEqual({ text: "?", cursor: 1 });
  });
});

describe("PromptInputHandler: deletion", () => {
  test("backspace deletes the char before the cursor", () => {
    const h = mount("ab");
    h.press("", { backspace: true });
    expect(h.state()).toEqual({ text: "a", cursor: 1 });
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
  });

  test("backspace at the start of the prompt is a no-op", () => {
    const h = mount("ab");
    h.press("", { leftArrow: true });
    h.press("", { leftArrow: true });
    h.actions.length = 0;
    h.press("", { backspace: true });
    expect(h.actions).toEqual([]);
  });

  test("forward-delete removes the char after the cursor", () => {
    const h = mount("ab");
    h.press("", { home: true });
    h.press("", { delete: true });
    expect(h.state()).toEqual({ text: "b", cursor: 0 });
  });

  test("forward-delete at the end is a no-op", () => {
    const h = mount("ab");
    h.actions.length = 0;
    h.press("", { delete: true });
    expect(h.actions).toEqual([]);
  });

  test("ctrl+w deletes the previous word", () => {
    const h = mount("foo bar");
    h.press("w", { ctrl: true });
    expect(h.state()).toEqual({ text: "foo ", cursor: 4 });
    expect(h.actions).toEqual([{ kind: "delete-word-backward" }]);
  });

  test("ctrl+u clears the line", () => {
    const h = mount("some text");
    h.press("u", { ctrl: true });
    expect(h.state()).toEqual({ text: "", cursor: 0 });
    expect(h.actions).toEqual([{ kind: "clear" }]);
  });

  test("ctrl+u on an empty line is a no-op", () => {
    const h = mount("");
    h.press("u", { ctrl: true });
    expect(h.actions).toEqual([]);
  });
});

describe("PromptInputHandler: cursor motion", () => {
  test("home and end jump to the prompt bounds", () => {
    const h = mount("abc");
    h.press("", { home: true });
    expect(h.state().cursor).toBe(0);
    h.press("", { end: true });
    expect(h.state().cursor).toBe(3);
  });

  test("word motion crosses whole words", () => {
    const h = mount("foo bar");
    h.press("b", { meta: true });
    expect(h.state().cursor).toBe(4);
    h.press("b", { meta: true });
    expect(h.state().cursor).toBe(0);
  });

  test("visual up moves onto the previous wrapped row via layout", () => {
    // "aaa bbb ccc" at width 5 soft-wraps to rows ["aaa ", "bbb ", "ccc"].
    const h = mount("aaa bbb ccc", { wrapWidth: 5 });
    h.press("", { end: true });
    expect(h.state().cursor).toBe(11);
    h.press("", { upArrow: true });
    expect(h.actions.at(-1)?.kind).toBe("set-cursor");
    // Off the last row (starts at offset 8), up onto the "bbb " row (offsets 4..8).
    expect(h.state().cursor).toBeGreaterThanOrEqual(4);
    expect(h.state().cursor).toBeLessThan(8);
  });

  test("visual down moves onto the next logical line via layout", () => {
    const h = mount("hello\nworld");
    h.press("", { home: true });
    h.press("", { downArrow: true });
    expect(h.actions.at(-1)?.kind).toBe("set-cursor");
    expect(h.state().cursor).toBeGreaterThanOrEqual(6);
  });
});

describe("PromptInputHandler: submit and inert keys", () => {
  test("return submits the current value without emitting an action", () => {
    const h = mount("ship it");
    h.press("", { return: true });
    expect(h.submits).toEqual(["ship it"]);
    expect(h.actions).toEqual([]);
  });

  test("shift+return inserts a newline instead of submitting", () => {
    const h = mount("a");
    h.press("", { return: true, shift: true });
    expect(h.submits).toEqual([]);
    expect(h.state()).toEqual({ text: "a\n", cursor: 2 });
  });

  test("ctrl+c and tab are inert", () => {
    const h = mount("x");
    h.press("c", { ctrl: true });
    h.press("", { tab: true });
    expect(h.actions).toEqual([]);
    expect(h.submits).toEqual([]);
  });
});

describe("PromptInputHandler: meta prefix", () => {
  test("escape then backspace deletes the previous word", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("", { backspace: true });
    expect(h.state()).toEqual({ text: "foo ", cursor: 4 });
    expect(h.actions).toEqual([{ kind: "delete-word-backward" }]);
  });

  test("backspace without a preceding escape deletes a single char", () => {
    const h = mount("foo bar");
    h.press("", { backspace: true });
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
  });
});
