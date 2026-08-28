import { describe, expect, test } from "bun:test";
import { formatSelectFrame, nextSelectIndex, selectKeyFor, selectOption } from "./cli-select";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const ENTER = "\r";
const ESC = "\u001b";
const CTRL_C = "\u0003";

function fakeTerminal(isTTY = true) {
  const listeners: Array<(chunk: string) => void> = [];
  let raw = false;
  const written: string[] = [];
  return {
    written,
    isRaw: () => raw,
    press: (chunk: string) => {
      for (const listener of [...listeners]) listener(chunk);
    },
    io: {
      input: {
        isTTY,
        setRawMode: (mode: boolean) => {
          raw = mode;
        },
        resume: () => {},
        pause: () => {},
        on: (_event: "data", listener: (chunk: Buffer | string) => void) => {
          listeners.push(listener as (chunk: string) => void);
        },
        off: (_event: "data", listener: (chunk: Buffer | string) => void) => {
          const at = listeners.indexOf(listener as (chunk: string) => void);
          if (at >= 0) listeners.splice(at, 1);
        },
      },
      write: (chunk: string) => {
        written.push(chunk);
      },
    },
  };
}

const OPTIONS = [
  { value: "a", label: "anthropic (none)" },
  { value: "b", label: "google (none)" },
  { value: "c", label: "openai (subscription)" },
];

describe("selectKeyFor", () => {
  test("maps arrows, enter, escape and ctrl-c", () => {
    expect(selectKeyFor(UP)).toBe("up");
    expect(selectKeyFor(DOWN)).toBe("down");
    expect(selectKeyFor(ENTER)).toBe("confirm");
    expect(selectKeyFor("\n")).toBe("confirm");
    expect(selectKeyFor(ESC)).toBe("cancel");
    expect(selectKeyFor(CTRL_C)).toBe("abort");
    expect(selectKeyFor("x")).toBe("none");
  });
});

describe("nextSelectIndex", () => {
  test("clamps at both ends rather than wrapping", () => {
    expect(nextSelectIndex(0, 3, "up")).toBe(0);
    expect(nextSelectIndex(2, 3, "down")).toBe(2);
    expect(nextSelectIndex(1, 3, "up")).toBe(0);
    expect(nextSelectIndex(1, 3, "down")).toBe(2);
    expect(nextSelectIndex(1, 3, "none")).toBe(1);
  });
});

describe("formatSelectFrame", () => {
  test("marks the chosen row and dims the rest", () => {
    const frame = formatSelectFrame(["one", "two"], 1);
    expect(frame[1]).toContain("❯ two");
    expect(frame[0]).toContain("one");
    expect(frame[0]).not.toContain("❯");
    expect(frame).toHaveLength(3);
  });
});

describe("selectOption", () => {
  test("returns the row the cursor is on when enter is pressed", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(DOWN);
    terminal.press(DOWN);
    terminal.press(ENTER);
    expect(await selection).toBe("c");
  });

  test("stops at the last row instead of wrapping to the first", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    for (let press = 0; press < 5; press += 1) terminal.press(DOWN);
    terminal.press(ENTER);
    expect(await selection).toBe("c");
  });

  test("escape returns nothing and leaves the exit code alone", async () => {
    process.exitCode = 0;
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(ESC);
    expect(await selection).toBeUndefined();
    expect(process.exitCode).toBe(0);
  });

  test("ctrl-c returns nothing and fails the command", async () => {
    process.exitCode = 0;
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(CTRL_C);
    expect(await selection).toBeUndefined();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test("restores cooked mode and the cursor on the way out", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    expect(terminal.isRaw()).toBe(true);
    terminal.press(ENTER);
    await selection;
    expect(terminal.isRaw()).toBe(false);
    expect(terminal.written.join("")).toContain("\u001b[?25h");
  });

  test("redraws in place rather than reprinting the list", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(DOWN);
    terminal.press(ENTER);
    await selection;
    const redraw = terminal.written[2] ?? "";
    expect(redraw.startsWith("\u001b[A".repeat(4))).toBe(true);
  });

  test("asks nothing when there is no terminal to ask in", async () => {
    const terminal = fakeTerminal(false);
    expect(await selectOption(OPTIONS, terminal.io)).toBeUndefined();
    expect(terminal.written).toEqual([]);
  });
});
