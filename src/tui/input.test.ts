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
    const { key } = parse("\r");
    expect(key.return).toBe(true);
  });

  test("tab", () => {
    const { key } = parse("\t");
    expect(key.tab).toBe(true);
  });

  test("backspace", () => {
    const { key } = parse("\x7f");
    expect(key.backspace).toBe(true);
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
    const { key } = parse("\x1b[A");
    expect(key.upArrow).toBe(true);
  });

  test("arrow down", () => {
    const { key } = parse("\x1b[B");
    expect(key.downArrow).toBe(true);
  });

  test("shift+tab", () => {
    const { key } = parse("\x1b[Z");
    expect(key.tab).toBe(true);
    expect(key.shift).toBe(true);
  });

  test("delete key", () => {
    const { key } = parse("\x1b[3~");
    expect(key.delete).toBe(true);
  });

  test("home key", () => {
    const { key } = parse("\x1b[H");
    expect(key.home).toBe(true);
  });

  test("end key", () => {
    const { key } = parse("\x1b[F");
    expect(key.end).toBe(true);
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
      const { key } = parse("\x1b[1;2A");
      expect(key.upArrow).toBe(true);
      expect(key.shift).toBe(true);
    });

    test("alt+right", () => {
      const { key } = parse("\x1b[1;3C");
      expect(key.rightArrow).toBe(true);
      expect(key.meta).toBe(true);
    });

    test("ctrl+left", () => {
      const { key } = parse("\x1b[1;5D");
      expect(key.leftArrow).toBe(true);
      expect(key.ctrl).toBe(true);
    });
  });

  describe("meta prefix", () => {
    test("alt+backspace", () => {
      const { key } = parse("\x1b\x7f");
      expect(key.meta).toBe(true);
      expect(key.backspace).toBe(true);
    });
  });
});
