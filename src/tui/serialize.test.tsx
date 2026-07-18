import { describe, expect, test } from "bun:test";
import { Box, Text } from "./components";
import { renderToString } from "./render-to-string";
import { clipLine, stripAnsi, stripAnsiLength } from "./serialize";
import { renderPlain } from "./test-utils";

describe("serialize", () => {
  describe("text", () => {
    test("renders plain text", () => {
      expect(renderPlain(<Text>hello</Text>)).toBe("hello");
    });

    test("renders nested text", () => {
      expect(
        renderPlain(
          <Text>
            hello <Text bold>world</Text>
          </Text>,
        ),
      ).toBe("hello world");
    });

    test("renders empty text as empty string", () => {
      expect(renderPlain(<Text>{""}</Text>)).toBe("");
    });
  });

  describe("box column", () => {
    test("renders children as lines", () => {
      expect(
        renderPlain(
          <Box flexDirection="column">
            <Text>line 1</Text>
            <Text>line 2</Text>
          </Box>,
        ),
      ).toBe("line 1\nline 2");
    });

    test("pads lines to width", () => {
      expect(
        renderPlain(
          <Box flexDirection="column" width={10}>
            <Text>hi</Text>
          </Box>,
        ),
      ).toBe("hi");
    });
  });

  describe("box row", () => {
    test("concatenates children horizontally", () => {
      expect(
        renderPlain(
          <Box>
            <Text>hello </Text>
            <Text>world</Text>
          </Box>,
        ),
      ).toBe("hello world");
    });
  });

  describe("justifyContent", () => {
    test("space-between distributes gap", () => {
      const out = renderPlain(
        <Box justifyContent="space-between" width={20}>
          <Text>a</Text>
          <Text>b</Text>
        </Box>,
      );
      expect(out).toBe("a                  b");
    });

    test("space-between with three children", () => {
      const out = renderPlain(
        <Box justifyContent="space-between" width={21}>
          <Text>a</Text>
          <Text>b</Text>
          <Text>c</Text>
        </Box>,
      );
      expect(out).toBe("a         b         c");
    });

    test("flex-end right-aligns content", () => {
      const out = renderPlain(
        <Box justifyContent="flex-end" width={20}>
          <Text>end</Text>
        </Box>,
      );
      expect(out).toBe("                 end");
    });
  });

  describe("flexWrap", () => {
    test("nowrap keeps children on one line", () => {
      const out = renderPlain(
        <Box width={10}>
          <Text>hello</Text>
          <Text>world</Text>
        </Box>,
      );
      expect(out).toBe("helloworld");
    });

    test("wrap stacks children when they overflow", () => {
      const out = renderPlain(
        <Box flexWrap="wrap" width={10}>
          <Text>hello</Text>
          <Text>world!</Text>
        </Box>,
      );
      expect(out).toBe("hello\nworld!");
    });

    test("wrap keeps row when children fit", () => {
      const out = renderPlain(
        <Box flexWrap="wrap" width={20}>
          <Text>hello</Text>
          <Text>world</Text>
        </Box>,
      );
      expect(out).toBe("helloworld");
    });

    test("wrap with space-between groups children into rows", () => {
      const out = renderPlain(
        <Box flexWrap="wrap" justifyContent="space-between" width={20}>
          <Text>left</Text>
          <Text>middle</Text>
          <Text>right</Text>
        </Box>,
      );
      // "left" (4) + "middle" (6) + "right" (5) = 15, fits in 20
      expect(out).toBe("left   middle  right");
    });

    test("wrap with space-between wraps when too wide", () => {
      const out = renderPlain(
        <Box flexWrap="wrap" justifyContent="space-between" width={15}>
          <Text>hello world</Text>
          <Text>overflow!</Text>
        </Box>,
      );
      // "hello world" (11) + "overflow!" (9) = 20 > 15, wraps
      expect(out).toBe("hello world\noverflow!");
    });
  });

  describe("styles", () => {
    test("renderToString includes ANSI codes", () => {
      const raw = renderToString(<Text bold>hi</Text>);
      expect(raw).toContain("\x1b[1m");
      expect(raw).toContain("hi");
      expect(raw).toContain("\x1b[0m");
    });

    test("renderPlain strips ANSI codes", () => {
      expect(renderPlain(<Text bold>hi</Text>)).toBe("hi");
      expect(renderPlain(<Text color="red">hi</Text>)).toBe("hi");
      expect(renderPlain(<Text dimColor>hi</Text>)).toBe("hi");
    });
  });

  describe("stripAnsiLength", () => {
    test("counts visible characters ignoring CSI sequences", () => {
      expect(stripAnsiLength("\x1b[1mhello\x1b[0m")).toBe(5);
    });

    test("counts visible characters ignoring OSC sequences (BEL terminated)", () => {
      expect(stripAnsiLength("\x1b]0;title\x07hello")).toBe(5);
    });

    test("counts visible characters ignoring OSC sequences (ST terminated)", () => {
      expect(stripAnsiLength("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")).toBe(4);
    });

    test("handles plain text", () => {
      expect(stripAnsiLength("hello world")).toBe(11);
    });

    test("counts CJK characters as 2 columns each", () => {
      expect(stripAnsiLength("こんにちは")).toBe(10);
    });

    test("counts emoji as 2 columns each", () => {
      expect(stripAnsiLength("😀🎉")).toBe(4);
    });

    test("counts CJK with ANSI codes correctly", () => {
      expect(stripAnsiLength("\x1b[1mこんにちは\x1b[0m")).toBe(10);
    });
  });

  describe("clipLine", () => {
    const RESET = "\x1b[0m";

    test("leaves lines that fit unchanged", () => {
      expect(clipLine("hello", 5)).toBe("hello");
      expect(clipLine("hi", 10)).toBe("hi");
      expect(clipLine("\x1b[1mhello\x1b[0m", 5)).toBe("\x1b[1mhello\x1b[0m");
    });

    test("clips over-width plain text and appends an ellipsis", () => {
      expect(clipLine("hello world", 5)).toBe(`hell…${RESET}`);
    });

    test("reserves exactly one column for the ellipsis", () => {
      expect(stripAnsiLength(clipLine("abcdefgh", 4))).toBe(4);
      expect(clipLine("abcdefgh", 4)).toBe(`abc…${RESET}`);
    });

    test("returns empty for non-positive width", () => {
      expect(clipLine("hello", 0)).toBe("");
      expect(clipLine("hello", -3)).toBe("");
    });

    test("width of one yields just the ellipsis", () => {
      expect(clipLine("hello", 1)).toBe(`…${RESET}`);
    });

    test("preserves escape sequences before the cut and closes with reset", () => {
      const out = clipLine("\x1b[31mred text here\x1b[0m", 5);
      expect(out.startsWith("\x1b[31m")).toBe(true);
      expect(out.endsWith(RESET)).toBe(true);
      expect(stripAnsiLength(out)).toBe(5);
    });

    test("does not split a wide grapheme across the boundary", () => {
      expect(stripAnsiLength(clipLine("aあ", 2))).toBeLessThanOrEqual(2);
      expect(clipLine("aあ", 2)).toBe(`a…${RESET}`);
      expect(stripAnsiLength(clipLine("ああ", 3))).toBeLessThanOrEqual(3);
    });

    // Property tests: invariants must hold across many generated inputs.
    const alphabet = ["a", "z", " ", "あ", "😀", "\x1b[1m", "\x1b[0m", "\x1b[31m", "\t"];
    function nextSeed(s: number): number {
      return (s * 1664525 + 1013904223) >>> 0;
    }
    function generate(seed: number): { line: string; width: number } {
      let s = nextSeed(seed);
      const len = s % 24;
      let line = "";
      for (let i = 0; i < len; i++) {
        s = nextSeed(s);
        line += alphabet[s % alphabet.length];
      }
      s = nextSeed(s);
      return { line, width: s % 20 };
    }

    test("visible width never exceeds the target", () => {
      for (let seed = 0; seed < 500; seed++) {
        const { line, width } = generate(seed);
        expect(stripAnsiLength(clipLine(line, width))).toBeLessThanOrEqual(Math.max(0, width));
      }
    });

    test("clipped output always closes any open style with a reset", () => {
      for (let seed = 0; seed < 500; seed++) {
        const { line, width } = generate(seed);
        const out = clipLine(line, width);
        if (width > 0 && stripAnsiLength(line) > width) {
          expect(out.endsWith(RESET)).toBe(true);
        }
      }
    });

    test("stripped output never contains a partial escape (ESC byte)", () => {
      for (let seed = 0; seed < 500; seed++) {
        const { line, width } = generate(seed);
        expect(stripAnsi(clipLine(line, width))).not.toContain("\x1b");
      }
    });
  });

  describe("box overflow", () => {
    test("truncate clips a column line to the box width", () => {
      const out = renderPlain(
        <Box flexDirection="column" width={6} overflow="truncate">
          <Text>hello world</Text>
        </Box>,
      );
      expect(out).toBe("hello…");
    });

    test("visible default keeps the full line", () => {
      const out = renderPlain(
        <Box flexDirection="column" width={6}>
          <Text>hello world</Text>
        </Box>,
      );
      expect(out).toBe("hello world");
    });

    test("truncate still pads a short line to the box width", () => {
      const out = renderToString(
        <Box flexDirection="column" width={6} overflow="truncate">
          <Text>hi</Text>
        </Box>,
      );
      expect(out).toBe("hi    ");
    });

    test("truncate clips a row line to the box width", () => {
      const out = renderPlain(
        <Box width={4} overflow="truncate">
          <Text>abcdef</Text>
        </Box>,
      );
      expect(out).toBe("abc…");
    });

    test("truncate clips space-between rows to the box width", () => {
      const raw = renderToString(
        <Box justifyContent="space-between" width={8} overflow="truncate">
          <Text>aaaaa</Text>
          <Text>bbbbb</Text>
        </Box>,
      );
      expect(stripAnsiLength(raw)).toBe(8);
    });

    test("truncate clips flex-end rows to the box width", () => {
      const raw = renderToString(
        <Box justifyContent="flex-end" width={6} overflow="truncate">
          <Text>abcdefghij</Text>
        </Box>,
      );
      expect(stripAnsiLength(raw)).toBe(6);
    });

    test("truncate re-pads a wide-grapheme cut to full box width", () => {
      const raw = renderToString(
        <Box flexDirection="column" width={4} overflow="truncate">
          <Text>ab漢漢</Text>
        </Box>,
      );
      expect(stripAnsiLength(raw)).toBe(4);
    });
  });

  describe("text sanitization", () => {
    test("strips whole CSI escape sequences", () => {
      expect(renderPlain(<Text>{"\x1b[2J\x1b[3J\x1b[Hhello"}</Text>)).toBe("hello");
      expect(renderPlain(<Text>{"\x1b[32mgreen\x1b[39m"}</Text>)).toBe("green");
    });

    test("strips whole OSC sequences", () => {
      expect(renderPlain(<Text>{"\x1b]0;evil title\x07world"}</Text>)).toBe("world");
    });

    test("preserves newlines and tabs", () => {
      expect(renderPlain(<Text>{"a\nb\tc"}</Text>)).toBe("a\nb\tc");
    });

    test("strips other C0 control chars", () => {
      expect(renderPlain(<Text>{"a\x00b\x01c\x7f"}</Text>)).toBe("abc\x7f");
    });
  });
});
