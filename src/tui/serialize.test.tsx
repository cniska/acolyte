import { describe, expect, test } from "bun:test";
import { renderPlain } from "../tui-test-utils";
import { Box, Text } from "./components";
import { renderToString } from "./render-to-string";

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
});
