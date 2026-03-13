import { describe, expect, test } from "bun:test";
import { parseKeyInput } from "./input";

function parse(data: string) {
  const results = parseKeyInput(data);
  return results[0] ?? { input: "", key: {} };
}

describe("parseKeyInput", () => {
  test("regular character", () => {
    const { input, key } = parse("a");
    expect(input).toBe("a");
    expect(key.ctrl).toBe(false);
    expect(key.meta).toBe(false);
  });

  test("enter", () => {
    const { input, key } = parse("\r");
    expect(key.return).toBe(true);
    expect(input).toBe("");
  });

  test("tab", () => {
    const { input, key } = parse("\t");
    expect(key.tab).toBe(true);
    expect(input).toBe("");
  });

  test("backspace", () => {
    const { input, key } = parse("\x7f");
    expect(key.backspace).toBe(true);
    expect(input).toBe("");
  });

  test("escape", () => {
    const { input, key } = parse("\x1b");
    expect(key.escape).toBe(true);
    expect(input).toBe("");
  });

  test("ctrl+c", () => {
    const { input, key } = parse("\x03");
    expect(key.ctrl).toBe(true);
    expect(input).toBe("c");
  });

  test("arrow up", () => {
    const { input, key } = parse("\x1b[A");
    expect(key.upArrow).toBe(true);
    expect(input).toBe("");
  });

  test("arrow down", () => {
    const { input, key } = parse("\x1b[B");
    expect(key.downArrow).toBe(true);
    expect(input).toBe("");
  });

  test("shift+tab", () => {
    const { input, key } = parse("\x1b[Z");
    expect(key.tab).toBe(true);
    expect(key.shift).toBe(true);
    expect(input).toBe("");
  });

  test("delete key", () => {
    const { input, key } = parse("\x1b[3~");
    expect(key.delete).toBe(true);
    expect(input).toBe("");
  });

  test("home key", () => {
    const { input, key } = parse("\x1b[H");
    expect(key.home).toBe(true);
    expect(input).toBe("");
  });

  test("end key", () => {
    const { input, key } = parse("\x1b[F");
    expect(key.end).toBe(true);
    expect(input).toBe("");
  });

  test("SS3 home/end", () => {
    expect(parse("\x1bOH").key.home).toBe(true);
    expect(parse("\x1bOF").key.end).toBe(true);
    expect(parse("\x1bOH").input).toBe("");
  });

  describe("kitty keyboard protocol", () => {
    test("escape via kitty", () => {
      const { key } = parse("\x1b[27u");
      expect(key.escape).toBe(true);
    });

    test("enter via kitty", () => {
      const { key } = parse("\x1b[13u");
      expect(key.return).toBe(true);
    });

    test("ctrl+a via kitty", () => {
      const { input, key } = parse("\x1b[97;5u");
      expect(key.ctrl).toBe(true);
      expect(input).toBe("a");
    });

    test("shift+enter via kitty", () => {
      const { key } = parse("\x1b[13;2u");
      expect(key.return).toBe(true);
      expect(key.shift).toBe(true);
    });

    test("regular char via kitty", () => {
      const { input } = parse("\x1b[120u");
      expect(input).toBe("x");
    });
  });

  describe("modifier arrows", () => {
    test("shift+up", () => {
      const { input, key } = parse("\x1b[1;2A");
      expect(key.upArrow).toBe(true);
      expect(key.shift).toBe(true);
      expect(input).toBe("");
    });

    test("alt+right (word nav)", () => {
      const { input, key } = parse("\x1b[1;3C");
      expect(key.rightArrow).toBe(true);
      expect(key.meta).toBe(true);
      expect(input).toBe("");
    });

    test("ctrl+left (word nav)", () => {
      const { input, key } = parse("\x1b[1;5D");
      expect(key.leftArrow).toBe(true);
      expect(key.ctrl).toBe(true);
      expect(input).toBe("");
    });

    test("super+left (Cmd+arrow, line nav)", () => {
      const { input, key } = parse("\x1b[1;9D");
      expect(key.leftArrow).toBe(true);
      expect(key.super).toBe(true);
      expect(input).toBe("");
    });

    test("super+right (Cmd+arrow, line nav)", () => {
      const { input, key } = parse("\x1b[1;9C");
      expect(key.rightArrow).toBe(true);
      expect(key.super).toBe(true);
      expect(input).toBe("");
    });

    test("super+shift+left (Cmd+Shift+arrow)", () => {
      const { key } = parse("\x1b[1;10D");
      expect(key.leftArrow).toBe(true);
      expect(key.super).toBe(true);
      expect(key.shift).toBe(true);
    });

    test("super+home", () => {
      const { key } = parse("\x1b[1;9H");
      expect(key.home).toBe(true);
      expect(key.super).toBe(true);
    });
  });

  describe("meta prefix", () => {
    test("alt+backspace", () => {
      const { input, key } = parse("\x1b\x7f");
      expect(key.meta).toBe(true);
      expect(key.backspace).toBe(true);
      expect(input).toBe("");
    });

    test("alt+b (word left)", () => {
      const { input, key } = parse("\x1bb");
      expect(key.meta).toBe(true);
      expect(input).toBe("b");
    });

    test("alt+f (word right)", () => {
      const { input, key } = parse("\x1bf");
      expect(key.meta).toBe(true);
      expect(input).toBe("f");
    });
  });

  describe("CSI input field is empty", () => {
    test("parsed CSI sequences yield empty input", () => {
      expect(parse("\x1b[A").input).toBe("");
      expect(parse("\x1b[1;5D").input).toBe("");
      expect(parse("\x1b[3~").input).toBe("");
      expect(parse("\x1b[1;9C").input).toBe("");
    });
  });
});
