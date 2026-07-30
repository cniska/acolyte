import { afterEach, describe, expect, spyOn, test } from "bun:test";
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
  pressWithoutRender: (input: string, key?: PressKey) => void;
  render: () => void;
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
    pressWithoutRender(input, key) {
      handler?.(input, { ...emptyKey(), ...key });
    },
    render: flush,
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

describe("PromptInputHandler: deletion", () => {
  test("backspace deletes the char before the cursor", () => {
    const h = mount("ab");
    h.press("", { backspace: true });
    expect(h.state()).toEqual({ text: "a", cursor: 1 });
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
    expect(h.pastes).toEqual([false]);
  });

  test("only an insert can report a paste, whatever the key carries", () => {
    const h = mount("ab");
    h.press("", { backspace: true, paste: true });
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
    expect(h.pastes).toEqual([false]);
  });

  /** The guard matrix lives with resolvePromptEdit; this pins that a suppressed
   *  decision reaches neither onAction nor onCursorLine, which chat-state reads
   *  as "the text did not change". */
  test("a suppressed edit emits nothing at all", () => {
    const h = mount("ab");
    h.press("", { home: true });
    h.cursorLines.length = 0;
    h.press("", { backspace: true });
    expect(h.actions).toEqual([{ kind: "move", direction: "home" }]);
    expect(h.cursorLines).toEqual([]);
    expect(h.state()).toEqual({ text: "ab", cursor: 0 });
  });

  test("forward-delete removes the char after the cursor", () => {
    const h = mount("ab");
    h.press("", { home: true });
    h.press("", { delete: true });
    expect(h.state()).toEqual({ text: "b", cursor: 0 });
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

/** The armed prefix is observable only through backspace, which resolves to
 *  delete_word_back while it is live and delete_back once it is cleared. */
describe("PromptInputHandler: meta prefix lifetime", () => {
  test("an inert key clears the prefix", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("", { tab: true });
    h.press("", { backspace: true });
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
  });

  test("a word deletion clears the prefix", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("w", { ctrl: true });
    h.press("", { backspace: true });
    expect(h.actions).toEqual([{ kind: "delete-word-backward" }, { kind: "delete-backward" }]);
    expect(h.state()).toEqual({ text: "foo", cursor: 3 });
  });

  test("a forward delete clears the prefix even when suppressed as a no-op", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("", { delete: true });
    h.press("", { backspace: true });
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
  });

  test("an insert clears the prefix", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("x");
    h.press("", { backspace: true });
    expect(h.actions).toEqual([{ kind: "insert", text: "x" }, { kind: "delete-backward" }]);
  });

  test("a horizontal move leaves the prefix armed", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("", { leftArrow: true });
    h.press("", { backspace: true });
    expect(h.actions.at(-1)).toEqual({ kind: "delete-word-backward" });
  });

  test("an end jump leaves the prefix armed", () => {
    const h = mount("foo bar");
    h.press("", { home: true });
    h.press("", { escape: true });
    h.press("", { end: true });
    h.press("", { backspace: true });
    expect(h.actions.at(-1)).toEqual({ kind: "delete-word-backward" });
    expect(h.state()).toEqual({ text: "foo ", cursor: 4 });
  });

  test("a vertical move leaves the prefix armed", () => {
    const h = mount("foo\nbar baz");
    h.press("", { escape: true });
    h.press("", { upArrow: true });
    h.press("", { backspace: true });
    expect(h.actions.at(-1)).toEqual({ kind: "delete-word-backward" });
  });

  test("the prefix expires once its window has passed", () => {
    const clock = spyOn(Date, "now");
    try {
      clock.mockReturnValue(1_000);
      const armed = mount("foo bar");
      armed.press("", { escape: true });
      clock.mockReturnValue(1_150);
      armed.press("", { backspace: true });
      expect(armed.actions).toEqual([{ kind: "delete-word-backward" }]);
      armed.unmount();

      clock.mockReturnValue(1_000);
      const expired = mount("foo bar");
      expired.press("", { escape: true });
      clock.mockReturnValue(1_151);
      expired.press("", { backspace: true });
      expect(expired.actions).toEqual([{ kind: "delete-backward" }]);
    } finally {
      clock.mockRestore();
    }
  });

  test("submit leaves the prefix armed", () => {
    const h = mount("foo bar");
    h.press("", { escape: true });
    h.press("", { return: true });
    h.press("", { backspace: true });
    expect(h.submits).toEqual(["foo bar"]);
    expect(h.actions).toEqual([{ kind: "delete-word-backward" }]);
  });
});

describe("PromptInputHandler: keystrokes between renders", () => {
  test("a second keystroke resolves against the first, not against stale props", () => {
    const h = mount();
    h.pressWithoutRender("a");
    h.pressWithoutRender("?");
    h.render();
    expect(h.actions).toEqual([
      { kind: "insert", text: "a" },
      { kind: "insert", text: "?" },
    ]);
    expect(h.state()).toEqual({ text: "a?", cursor: 2 });
  });

  test("a no-op guard sees an edit that has not rendered yet", () => {
    const h = mount("a");
    h.pressWithoutRender("", { backspace: true });
    h.pressWithoutRender("", { backspace: true });
    h.render();
    expect(h.actions).toEqual([{ kind: "delete-backward" }]);
    expect(h.state()).toEqual({ text: "", cursor: 0 });
  });
});
