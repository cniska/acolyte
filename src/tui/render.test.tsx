import { describe, expect, test } from "bun:test";
import type React from "react";
import { createElement as h, useEffect, useState } from "react";
import { ChatInputPanel } from "../chat-input-panel";
import { ansi } from "./styles";

function withMockedStdout(
  fn: (writes: string[]) => void | Promise<void>,
  options: { columns?: number; rows?: number } = {},
): Promise<string[]> {
  const writes: string[] = [];
  const columns = options.columns ?? 120;
  const rows = options.rows ?? 24;
  const saved = {
    write: process.stdout.write,
    isTTY: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    columns: Object.getOwnPropertyDescriptor(process.stdout, "columns"),
    rows: Object.getOwnPropertyDescriptor(process.stdout, "rows"),
  };
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
  process.stdout.write = ((data: string) => {
    writes.push(data);
    return true;
  }) as typeof process.stdout.write;
  const restore = () => {
    process.stdout.write = saved.write;
    for (const key of ["isTTY", "columns", "rows"] as const)
      if (saved[key]) Object.defineProperty(process.stdout, key, saved[key]);
  };
  return Promise.resolve(fn(writes)).then(
    () => {
      restore();
      return writes;
    },
    (e) => {
      restore();
      throw e;
    },
  );
}

function replayVisibleScreen(writes: string[], rows: number, columns: number): string[] {
  const screen = Array.from({ length: rows }, () => Array.from({ length: columns }, () => " "));
  let row = 0;
  let col = 0;

  const scroll = (): void => {
    screen.shift();
    screen.push(Array.from({ length: columns }, () => " "));
    row = rows - 1;
  };

  const eraseDown = (): void => {
    const currentRow = screen[row];
    if (currentRow) {
      for (let c = col; c < columns; c++) currentRow[c] = " ";
    }
    for (let r = row + 1; r < rows; r++) {
      const nextRow = screen[r];
      if (!nextRow) continue;
      for (let c = 0; c < columns; c++) nextRow[c] = " ";
    }
  };

  const applyWrite = (data: string): void => {
    let index = 0;
    while (index < data.length) {
      const char = data[index];
      if (char === "\x1b" && data[index + 1] === "[") {
        let end = index + 2;
        while (end < data.length) {
          const code = data.charCodeAt(end);
          if (code >= 0x40 && code <= 0x7e) break;
          end += 1;
        }
        if (end >= data.length) break;
        const sequence = data.slice(index + 2, end);
        const finalByte = data[end];
        const paramText = sequence.replace(/^\?/, "");
        const param = paramText.length > 0 ? Number.parseInt(paramText, 10) : 1;
        if (finalByte === "A") {
          row = Math.max(0, row - (Number.isFinite(param) ? param : 1));
        } else if (finalByte === "J") {
          eraseDown();
        }
        index = end + 1;
        continue;
      }
      if (char === "\r") {
        col = 0;
        index += 1;
        continue;
      }
      if (char === "\n") {
        row += 1;
        col = 0;
        if (row >= rows) scroll();
        index += 1;
        continue;
      }
      if (col >= columns) {
        row += 1;
        col = 0;
        if (row >= rows) scroll();
      }
      if (row >= 0 && row < rows && col >= 0 && col < columns) {
        const currentRow = screen[row];
        if (currentRow) currentRow[col] = char;
      }
      col += 1;
      index += 1;
    }
  };

  for (const write of writes) applyWrite(write);
  return screen.map((line) => line.join("").trimEnd());
}

function extractFrameWrites(writes: string[]): string[] {
  const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
  return cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
}

function OverflowShrinkApp(props: { onUnmount: () => void }): React.JSX.Element {
  const [lines, setLines] = useState(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);

  useEffect(() => {
    const t1 = setTimeout(() => setLines(["B1", "B2", "B3", "B4"]), 20);
    const t2 = setTimeout(() => props.onUnmount(), 60);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [props.onUnmount]);

  return (
    <tui-box flexDirection="column">
      {lines.map((line) => (
        <tui-text key={line}>{line}</tui-text>
      ))}
    </tui-box>
  );
}

describe("render", () => {
  test("commitRender wraps output in sync markers", async () => {
    const writes = await withMockedStdout(async () => {
      const { render } = await import("./render");
      const app = render(h("tui-text", null, "hello"));
      await new Promise((r) => setTimeout(r, 100));
      app.unmount();
    });

    const renderWrites = writes.filter((w) => w.includes("hello"));
    expect(renderWrites.length).toBeGreaterThan(0);
    for (const w of renderWrites) {
      expect(w.startsWith(ansi.syncStart)).toBe(true);
      expect(w.endsWith(ansi.syncEnd)).toBe(true);
    }
  });

  test("commitRender normalizes multiline writes to CRLF", async () => {
    const writes = await withMockedStdout(async () => {
      const { render } = await import("./render");
      const app = render(h("tui-text", null, "alpha\nbravo"));
      await new Promise((r) => setTimeout(r, 100));
      app.unmount();
    });

    const renderWrite = writes.find((write) => write.includes("alpha")) ?? "";
    expect(renderWrite).toContain("alpha\r\nbravo");
    expect(renderWrite).not.toContain("alpha\nbravo");
  });

  test("resets frozen overflow when active content changes non-append-only", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");
        const app = render(<OverflowShrinkApp onUnmount={() => app.unmount()} />);
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );

    const visible = replayVisibleScreen(extractFrameWrites(writes), 6, 20);
    const joined = visible.join("\n");

    expect(joined).toContain("B1");
    expect(joined).toContain("B4");
    expect(joined).not.toContain("A1");
    expect(joined).not.toContain("A2");
    expect(joined).not.toContain("A3");
    expect(joined).not.toContain("A4");
  });

  test("height jumps use normal erase instead of forceRedraw", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");
        const app = render(<OverflowShrinkApp onUnmount={() => app.unmount()} />);
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );

    const redrawWrite = writes.find((write) => write.includes("B1")) ?? "";
    expect(redrawWrite).toContain("B1");
    // Normal erase+rewrite, not forceRedraw (which would duplicate scrollback).
    expect(redrawWrite).not.toContain(ansi.cursorTo(0, 0));
  });

  test("force redraw preserves static lines when opening the picker", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          const [open, setOpen] = useState(false);

          useEffect(() => {
            const openTimer = setTimeout(() => {
              setOpen(true);
            }, 20);
            const unmountTimer = setTimeout(() => {
              app.unmount();
            }, 60);
            return () => {
              clearTimeout(openTimer);
              clearTimeout(unmountTimer);
            };
          }, []);

          const items = [
            { label: "alibaba/qwen-3-235b", value: "a1" },
            { label: "alibaba/qwen3-max", value: "a2" },
            { label: "alibaba/qwen-3-14b", value: "a3" },
            { label: "alibaba/qwen-3-30b", value: "a4" },
            { label: "alibaba/qwen-3-32b", value: "a5" },
            { label: "alibaba/qwen3-coder", value: "a6" },
            { label: "alibaba/qwen3.5-plus", value: "a7" },
            { label: "alibaba/qwen3.6-plus", value: "a8" },
          ];
          const picker = open
            ? {
                kind: "model" as const,
                items,
                filtered: items,
                query: "",
                index: 1,
                scrollOffset: 0,
              }
            : null;

          return (
            <tui-box flexDirection="column">
              <tui-static>
                <tui-text>static line 1</tui-text>
                <tui-text>static line 2</tui-text>
              </tui-static>
              <tui-text>transcript line</tui-text>
              <ChatInputPanel
                picker={picker}
                onPickerQueryChange={() => {}}
                onPickerSubmit={() => {}}
                onCursorLine={() => {}}
                brandColor="white"
                value=""
                footerContext="~/code/acolyte · main · qwen3-235b-a22b-thinking"
              />
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 80, rows: 24 },
    );

    const frameWrites = extractFrameWrites(writes);
    const visible = replayVisibleScreen(frameWrites, 24, 80);
    const joined = visible.join("\n");

    expect(joined).toContain("static line 1");
    expect(joined).toContain("static line 2");
    expect(joined).toContain("transcript line");
    expect(joined).toContain("Model:");
    // Normal erase+rewrite is used instead of forceRedraw to avoid
    // duplicating content that has been pushed to the scrollback buffer.
    expect(frameWrites.some((write) => write.includes(ansi.cursorTo(0, 0)))).toBe(false);
  });

  test("height jumps do not duplicate static items in scrollback", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        // Simulate a chat turn: static header is flushed, then the active
        // region grows by several rows at once (pending indicator + response
        // row added in one commit).  Before the fix, the height-jump guard
        // called forceRedraw which re-emitted static items, duplicating
        // them in the scrollback.
        function App(): React.JSX.Element {
          const [phase, setPhase] = useState<"idle" | "streaming" | "done">("idle");

          useEffect(() => {
            const t1 = setTimeout(() => setPhase("streaming"), 20);
            const t2 = setTimeout(() => setPhase("done"), 40);
            const t3 = setTimeout(() => app.unmount(), 80);
            return () => {
              clearTimeout(t1);
              clearTimeout(t2);
              clearTimeout(t3);
            };
          }, []);

          return (
            <tui-box flexDirection="column">
              <tui-static>
                <tui-text>HEADER</tui-text>
              </tui-static>
              <tui-text>prompt</tui-text>
              {phase !== "idle" && <tui-text>response line 1</tui-text>}
              {phase !== "idle" && <tui-text>response line 2</tui-text>}
              {phase !== "idle" && <tui-text>response line 3</tui-text>}
              {phase === "done" && <tui-text>worked</tui-text>}
              {phase === "done" && <tui-text>status extra 1</tui-text>}
              {phase === "done" && <tui-text>status extra 2</tui-text>}
              <tui-text>───────</tui-text>
              <tui-text>input</tui-text>
              <tui-text>───────</tui-text>
              <tui-text>footer</tui-text>
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 40, rows: 12 },
    );

    const frameWrites = extractFrameWrites(writes);
    const allOutput = frameWrites.join("");

    // HEADER must appear exactly once — never duplicated by forceRedraw.
    const headerCount = allOutput.split("HEADER").length - 1;
    expect(headerCount).toBe(1);
  });

  test("frozen-content reset and repaint happen in a single syncWrite", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          const [lines, setLines] = useState(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);

          useEffect(() => {
            const t1 = setTimeout(() => setLines(["B1", "B2", "B3", "B4"]), 50);
            const t2 = setTimeout(() => app.unmount(), 150);
            return () => {
              clearTimeout(t1);
              clearTimeout(t2);
            };
          }, []);

          return (
            <tui-box flexDirection="column">
              {lines.map((line) => (
                <tui-text key={line}>{line}</tui-text>
              ))}
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );

    const redrawWrite = writes.find((w) => w.includes("B1")) ?? "";
    expect(redrawWrite).toContain("B1");
    // Erase must be in the SAME write as B1 — atomic within one BSU/ESU block.
    const hasErase = redrawWrite.includes(ansi.eraseDown) || redrawWrite.includes(`${ansi.cursorUp(1)}`);
    expect(hasErase).toBe(true);
  });

  test("resize triggers a re-render with updated dimensions", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        const app = render(h("tui-text", null, "resize test"));
        await new Promise((r) => setTimeout(r, 30));

        Object.defineProperty(process.stdout, "columns", { value: 60, configurable: true });
        process.stdout.emit("resize");
        await new Promise((r) => setTimeout(r, 50));
        app.unmount();
      },
      { columns: 80, rows: 24 },
    );

    const frameWrites = extractFrameWrites(writes);
    const resizeTestWrites = frameWrites.filter((w) => w.includes("resize test"));
    expect(resizeTestWrites.length).toBeGreaterThanOrEqual(2);
  });

  test("syncWrite skips BSU/ESU when TMUX is set", async () => {
    const savedTmux = process.env.TMUX;
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    try {
      const writes = await withMockedStdout(async () => {
        const { render } = await import("./render");
        const app = render(h("tui-text", null, "tmux test"));
        await new Promise((r) => setTimeout(r, 100));
        app.unmount();
      });
      const renderWrites = writes.filter((w) => w.includes("tmux test"));
      expect(renderWrites.length).toBeGreaterThan(0);
      for (const w of renderWrites) {
        expect(w.includes(ansi.syncStart)).toBe(false);
        expect(w.includes(ansi.syncEnd)).toBe(false);
      }
    } finally {
      if (savedTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = savedTmux;
    }
  });

  test("streaming state updates render incrementally, not batched into one commit", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        type Ref<T> = { current: T };
        const setText: Ref<(fn: (prev: string) => string) => void> = { current: () => {} };

        function App(): React.JSX.Element {
          const [text, setTextState] = useState("");
          setText.current = setTextState;
          return <tui-text>{text || "empty"}</tui-text>;
        }

        const app = render(<App />);
        await new Promise((r) => setTimeout(r, 50));

        // Simulate streaming: update state with delays between updates
        for (const word of ["Hello", "Hello world", "Hello world!"]) {
          setText.current(() => word);
          await new Promise((r) => setTimeout(r, 50));
        }

        await new Promise((r) => setTimeout(r, 50));
        app.unmount();
      },
      { columns: 40, rows: 6 },
    );

    const frameWrites = extractFrameWrites(writes);
    const hasHello = frameWrites.some((w) => w.includes("Hello") && !w.includes("world"));
    const hasHelloWorld = frameWrites.some((w) => w.includes("Hello world") && !w.includes("!"));
    const hasHelloWorldBang = frameWrites.some((w) => w.includes("Hello world!"));

    // Each intermediate state must appear in a separate write — not batched.
    expect(hasHello).toBe(true);
    expect(hasHelloWorld).toBe(true);
    expect(hasHelloWorldBang).toBe(true);
  });

  test("rapid state updates within throttle window still render final state", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        type Ref<T> = { current: T };
        const setText: Ref<(fn: (prev: string) => string) => void> = { current: () => {} };

        function App(): React.JSX.Element {
          const [text, setTextState] = useState("init");
          setText.current = setTextState;
          return <tui-text>{text}</tui-text>;
        }

        const app = render(<App />);
        await new Promise((r) => setTimeout(r, 50));

        // Fire 10 updates with no delay — all within one throttle window
        for (let i = 1; i <= 10; i++) {
          setText.current(() => `update_${i}`);
        }

        await new Promise((r) => setTimeout(r, 100));
        app.unmount();
      },
      { columns: 40, rows: 6 },
    );

    const frameWrites = extractFrameWrites(writes);
    // The final state must be rendered even if intermediate states were skipped.
    expect(frameWrites.some((w) => w.includes("update_10"))).toBe(true);
  });

  test("static items render immediately without waiting for throttle", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          const [items, setItems] = useState<string[]>([]);
          const [dynamic, setDynamic] = useState("active");
          useEffect(() => {
            const t1 = setTimeout(() => {
              setItems(["STATIC_1"]);
              setDynamic("after");
            }, 50);
            const t2 = setTimeout(() => app.unmount(), 150);
            return () => {
              clearTimeout(t1);
              clearTimeout(t2);
            };
          }, []);
          return (
            <tui-box flexDirection="column">
              <tui-static>
                {items.map((item) => (
                  <tui-text key={item}>{item}</tui-text>
                ))}
              </tui-static>
              <tui-text>{dynamic}</tui-text>
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 40, rows: 6 },
    );

    const frameWrites = extractFrameWrites(writes);
    expect(frameWrites.some((w) => w.includes("STATIC_1"))).toBe(true);
    expect(frameWrites.some((w) => w.includes("after"))).toBe(true);
  });

  test("unmount during throttle window does not lose final render", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          const [text, setText] = useState("before");
          useEffect(() => {
            const t1 = setTimeout(() => setText("final"), 50);
            const t2 = setTimeout(() => app.unmount(), 100);
            return () => {
              clearTimeout(t1);
              clearTimeout(t2);
            };
          }, []);
          return <tui-text>{text}</tui-text>;
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 40, rows: 6 },
    );

    const frameWrites = extractFrameWrites(writes);
    expect(frameWrites.some((w) => w.includes("final"))).toBe(true);
  });
});
