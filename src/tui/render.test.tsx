import { describe, expect, test } from "bun:test";
import type React from "react";
import { createElement as h, useEffect, useState } from "react";
import { physicalRowCount } from "./render";
import { ansi } from "./styles";
import { renderCapture } from "./test-utils";
import { replayTerminal } from "./vt";

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

// Screen-only view for the visible-region assertions below; transcript-integrity
// (scrollback) assertions live in vt.test.tsx.
function replayVisibleScreen(writes: string[], rows: number, columns: number): string[] {
  return replayTerminal(writes, rows, columns).screen;
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

  test("renders bottom-fitting slice when active region overflows", async () => {
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

  test("overflow lines are written to terminal so they scroll into scrollback", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          return (
            <tui-box flexDirection="column">
              {["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"].map((l) => (
                <tui-text key={l}>{l}</tui-text>
              ))}
            </tui-box>
          );
        }

        const app = render(<App />);
        await new Promise((r) => setTimeout(r, 80));
        app.unmount();
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );

    // rows=6 → maxLiveRows=5. 8 lines overflow by 3 (L1-L3).
    // Those 3 lines must appear in raw writes so the terminal can scroll them into scrollback.
    const allWrites = writes.join("");
    expect(allWrites).toContain("L1");
    expect(allWrites).toContain("L2");
    expect(allWrites).toContain("L3");
    // Bottom-fitting slice must also be present.
    expect(allWrites).toContain("L4");
    expect(allWrites).toContain("L8");
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

          const pickerItems = [
            "alibaba/qwen-3-235b",
            "alibaba/qwen3-max",
            "alibaba/qwen-3-14b",
            "alibaba/qwen-3-30b",
            "alibaba/qwen-3-32b",
            "alibaba/qwen3-coder",
            "alibaba/qwen3.5-plus",
            "alibaba/qwen3.6-plus",
          ];

          return (
            <tui-box flexDirection="column">
              <tui-static>
                <tui-text>static line 1</tui-text>
                <tui-text>static line 2</tui-text>
              </tui-static>
              <tui-text>transcript line</tui-text>
              <tui-box flexDirection="column">
                {open && pickerItems.map((item) => <tui-text key={item}>{item}</tui-text>)}
                <tui-text>Model: qwen3-235b-a22b-thinking</tui-text>
              </tui-box>
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

  test("overflow erase and repaint are atomic within one syncWrite", async () => {
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
    function App({ unmount }: { unmount: () => void }): React.JSX.Element {
      const [items, setItems] = useState<string[]>([]);
      const [dynamic, setDynamic] = useState("active");
      useEffect(() => {
        const t1 = setTimeout(() => {
          setItems(["STATIC_1"]);
          setDynamic("after");
        }, 50);
        const t2 = setTimeout(unmount, 150);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      }, [unmount]);
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

    const writes = await renderCapture(({ unmount }) => <App unmount={unmount} />, { columns: 40, rows: 6 });
    const frameWrites = extractFrameWrites(writes);
    expect(frameWrites.some((w) => w.includes("STATIC_1"))).toBe(true);
    expect(frameWrites.some((w) => w.includes("after"))).toBe(true);
  });

  test("unmount during throttle window does not lose final render", async () => {
    function App({ unmount }: { unmount: () => void }): React.JSX.Element {
      const [text, setText] = useState("before");
      useEffect(() => {
        const t1 = setTimeout(() => setText("final"), 50);
        const t2 = setTimeout(unmount, 100);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      }, [unmount]);
      return <tui-text>{text}</tui-text>;
    }

    const writes = await renderCapture(({ unmount }) => <App unmount={unmount} />, { columns: 40, rows: 6 });
    const frameWrites = extractFrameWrites(writes);
    expect(frameWrites.some((w) => w.includes("final"))).toBe(true);
  });

  test("single live line taller than viewport is not frozen so streaming updates stay in live region", async () => {
    // rows=4 → maxLiveRows=3. A single line wrapping to 4+ physical rows must not
    // be frozen — it stays in the live region so updates remain visible, not pushed
    // permanently to scrollback.
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");
        type Ref<T> = { current: T };
        const setLine: Ref<(v: string) => void> = { current: () => {} };

        function App(): React.JSX.Element {
          const [line, setLineState] = useState("A".repeat(81));
          setLine.current = setLineState;
          return <tui-text>{line}</tui-text>;
        }

        const app = render(<App />);
        await new Promise((r) => setTimeout(r, 50));
        setLine.current("B".repeat(81));
        await new Promise((r) => setTimeout(r, 50));
        app.unmount();
      },
      { columns: 20, rows: 4 },
    );

    const frameWrites = extractFrameWrites(writes);
    // B-content must be visible in the live region — not pushed to scrollback.
    const visible = replayVisibleScreen(frameWrites, 4, 20);
    const joined = visible.join("\n");
    expect(joined).toContain("B".repeat(20));
    expect(joined).not.toContain("A".repeat(20));
  });

  test("resize resets lastActiveLineCount so post-resize render does not use stale erase geometry", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          return (
            <tui-box flexDirection="column">
              <tui-text>resize line 1</tui-text>
              <tui-text>resize line 2</tui-text>
              <tui-text>resize line 3</tui-text>
            </tui-box>
          );
        }

        const app = render(<App />);
        // Let initial render settle — lastActiveLineCount is now > 0.
        await new Promise((r) => setTimeout(r, 50));
        process.stdout.emit("resize");
        // Wait for 16ms debounce + throttle window.
        await new Promise((r) => setTimeout(r, 80));
        app.unmount();
      },
      { columns: 80, rows: 24 },
    );

    const frameWrites = extractFrameWrites(writes);
    const contentWrites = frameWrites.filter((w) => w.includes("resize line 1"));
    // Initial render + post-resize render.
    expect(contentWrites.length).toBeGreaterThanOrEqual(2);
    // Post-resize: lastActiveLineCount was reset to 0, so eraseSequence() returns "".
    // The post-resize write must not contain a cursor-up erase for the old row count.
    const postResizeWrite = contentWrites[contentWrites.length - 1] ?? "";
    expect(postResizeWrite).not.toContain(ansi.cursorUp(2));
  });

  test("overflow after static flush is tracked so re-render does not re-emit frozen overflow lines", async () => {
    // rows=5 → maxLiveRows=4. Active has 6 lines so top 2 overflow. When static
    // items are flushed at the same time, the overflow must be recorded in
    // frozenLineCount so a subsequent active-change render does not re-emit them.
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          const [staticItems, setStaticItems] = useState<string[]>([]);
          const [extra, setExtra] = useState(false);

          useEffect(() => {
            const t1 = setTimeout(() => setStaticItems(["STATIC_ITEM"]), 30);
            const t2 = setTimeout(() => setExtra(true), 80);
            const t3 = setTimeout(() => app.unmount(), 200);
            return () => {
              clearTimeout(t1);
              clearTimeout(t2);
              clearTimeout(t3);
            };
          }, []);

          return (
            <tui-box flexDirection="column">
              <tui-static>
                {staticItems.map((item) => (
                  <tui-text key={item}>{item}</tui-text>
                ))}
              </tui-static>
              {["OVF1", "OVF2", "OVF3", "OVF4", "OVF5", "OVF6"].map((l) => (
                <tui-text key={l}>{l}</tui-text>
              ))}
              {extra && <tui-text>EXTRA</tui-text>}
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 20, rows: 5 },
    );

    const frameWrites = extractFrameWrites(writes);
    // OVF1 is the topmost overflow line. After the static flush, it should appear
    // in at most one write (the overflow-split that re-establishes frozen state).
    // With the bug, frozenLineCount is not recorded so the EXTRA re-render
    // re-emits OVF1 a second time — two writes after the flush, not one.
    const staticFlushIdx = frameWrites.findIndex((w) => w.includes("STATIC_ITEM"));
    expect(staticFlushIdx).toBeGreaterThanOrEqual(0);
    const writesAfterFlush = frameWrites.slice(staticFlushIdx);
    const ovf1AfterFlush = writesAfterFlush.filter((w) => w.includes("OVF1"));
    expect(ovf1AfterFlush.length).toBeLessThanOrEqual(1);
  });

  test("flush commits a pending throttled render immediately", async () => {
    const writes = await withMockedStdout(async () => {
      const { render } = await import("./render");

      function App({ unmount }: { unmount: () => void }): React.JSX.Element {
        const [text, setText] = useState("initial");
        useEffect(() => {
          // Two rapid state updates within the throttle window.
          setText("intermediate");
          setText("final");
          setTimeout(unmount, 200);
        }, [unmount]);
        return <tui-text>{text}</tui-text>;
      }

      const app = render(<App unmount={() => app.unmount()} />);
      await new Promise((r) => setTimeout(r, 16));
      app.flush();
      await app.waitUntilExit();
    });

    const frameWrites = extractFrameWrites(writes);
    expect(frameWrites.some((w) => w.includes("final"))).toBe(true);
  });
});

describe("physicalRowCount", () => {
  test("single ASCII line fits in columns", () => {
    expect(physicalRowCount("hello", 80)).toBe(0);
  });

  test("single ASCII line wraps", () => {
    expect(physicalRowCount("a".repeat(10), 5)).toBe(1);
  });

  test("CJK line counts each character as 2 columns", () => {
    // 5 CJK chars = 10 display cols; 8-col terminal → ceil(10/8)=2 rows − 1
    expect(physicalRowCount("こんにちは", 8)).toBe(1);
  });

  test("CJK line wraps when wider than columns", () => {
    // 10 CJK chars = 20 display cols; 8-col terminal → ceil(20/8)=3 rows − 1
    expect(physicalRowCount("こんにちはこんにちは", 8)).toBe(2);
  });

  test("emoji line counts each emoji as 2 columns", () => {
    // 3 emoji = 6 display cols; 4-col terminal → ceil(6/4)=2 rows − 1
    expect(physicalRowCount("😀🎉🔥", 4)).toBe(1);
  });

  test("multiline output sums physical rows", () => {
    // "hello" (5) in 80 cols = 1 row; "world" (5) in 80 cols = 1 row; total 2 rows - 1
    expect(physicalRowCount("hello\nworld", 80)).toBe(1);
  });
});
