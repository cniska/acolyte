import { describe, expect, test } from "bun:test";
import { formatSelectFrame, nextSelectIndex, readSelectKeys, selectOption } from "./cli-select";

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

describe("readSelectKeys", () => {
  test("maps arrows, enter and ctrl-c", () => {
    expect(readSelectKeys(UP).keys).toEqual(["up"]);
    expect(readSelectKeys(DOWN).keys).toEqual(["down"]);
    expect(readSelectKeys(ENTER).keys).toEqual(["confirm"]);
    expect(readSelectKeys("\n").keys).toEqual(["confirm"]);
    expect(readSelectKeys(CTRL_C).keys).toEqual(["abort"]);
    expect(readSelectKeys("x").keys).toEqual(["none"]);
  });

  test("reads every keypress a single coalesced read carries", () => {
    expect(readSelectKeys(`${DOWN}${DOWN}${DOWN}`).keys).toEqual(["down", "down", "down"]);
    expect(readSelectKeys(`${DOWN}${UP}${ENTER}`).keys).toEqual(["down", "up", "confirm"]);
  });

  test("reads arrows sent as SS3, the way a terminal in application cursor mode does", () => {
    expect(readSelectKeys("\u001bOA").keys).toEqual(["up"]);
    expect(readSelectKeys("\u001bOB").keys).toEqual(["down"]);
  });

  test("carries a sequence cut off by the end of the read", () => {
    expect(readSelectKeys(ESC)).toEqual({ keys: [], partial: ESC });
    expect(readSelectKeys(`${ESC}[`)).toEqual({ keys: [], partial: `${ESC}[` });
    expect(readSelectKeys(`${DOWN}${ESC}`)).toEqual({ keys: ["down"], partial: ESC });
  });

  test("never reads escape itself as a key, so a split arrow cannot cancel", () => {
    expect(readSelectKeys(ESC).keys).not.toContain("cancel");
    expect(readSelectKeys(`${ESC}b`).keys).toEqual(["none"]);
  });

  test("ignores sequences it has no use for", () => {
    expect(readSelectKeys("\u001b[C").keys).toEqual(["none"]);
    expect(readSelectKeys("\u001b[200~").keys).toEqual(["none"]);
    expect(readSelectKeys("\u001b[M !!").keys).not.toContain("cancel");
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
  });

  test("shows nothing but the rows", () => {
    expect(formatSelectFrame(["one", "two"], 0)).toHaveLength(2);
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

  test("holding a key, which arrives as one read, moves once per keypress", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(`${DOWN}${DOWN}`);
    terminal.press(ENTER);
    expect(await selection).toBe("c");
  });

  test("confirming mid-read ignores whatever followed it", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(`${DOWN}${ENTER}${DOWN}`);
    expect(await selection).toBe("b");
  });

  test("escape returns nothing and leaves the exit code alone", async () => {
    process.exitCode = 0;
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(ESC);
    expect(await selection).toBeUndefined();
    expect(process.exitCode).toBe(0);
  });

  test("an arrow split across two reads moves instead of cancelling", async () => {
    const terminal = fakeTerminal();
    const selection = selectOption(OPTIONS, terminal.io);
    terminal.press(ESC);
    terminal.press("[B");
    terminal.press(ENTER);
    expect(await selection).toBe("b");
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
    expect(redraw.startsWith("\u001b[A".repeat(3))).toBe(true);
  });

  test("a chosen list closes with a blank line and a cancelled one does not", async () => {
    const chosen = fakeTerminal();
    const chosenSelection = selectOption(OPTIONS, chosen.io);
    chosen.press(ENTER);
    await chosenSelection;
    expect(chosen.written.at(-1)?.endsWith("\n")).toBe(true);

    const cancelled = fakeTerminal();
    const cancelledSelection = selectOption(OPTIONS, cancelled.io);
    cancelled.press(ESC);
    await cancelledSelection;
    expect(cancelled.written.at(-1)?.endsWith("\n")).toBe(false);
  });

  test("asks nothing when there is no terminal to ask in", async () => {
    const terminal = fakeTerminal(false);
    expect(await selectOption(OPTIONS, terminal.io)).toBeUndefined();
    expect(terminal.written).toEqual([]);
  });
});
