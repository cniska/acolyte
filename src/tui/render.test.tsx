import { describe, expect, test } from "bun:test";
import type React from "react";
import { createElement as h, useEffect, useState, useSyncExternalStore } from "react";
import { reconciler } from "./reconciler";
import { physicalRowCount } from "./render";
import { ansi } from "./styles";
import { frameWrites, renderCapture, renderScript } from "./test-utils";
import { replayTerminal } from "./vt";

/** Mock process.stdin as a TTY so render() installs its focus-in handler.
 *  Returns `emit` to feed raw bytes and `restore` to put the real stdin back. */
function mockStdinTty(): { emit: (data: string) => void; restore: () => void } {
  const stdin = process.stdin;
  const savedIsTTY = Object.getOwnPropertyDescriptor(stdin, "isTTY");
  const savedSetRawMode = (stdin as { setRawMode?: unknown }).setRawMode;
  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  (stdin as { setRawMode: (m: boolean) => void }).setRawMode = () => {};
  return {
    emit: (data: string) => {
      stdin.emit("data", Buffer.from(data));
    },
    restore: () => {
      if (savedIsTTY) Object.defineProperty(stdin, "isTTY", savedIsTTY);
      else delete (stdin as { isTTY?: boolean }).isTTY;
      (stdin as { setRawMode?: unknown }).setRawMode = savedSetRawMode;
    },
  };
}

/** Force React to commit and the renderer to flush until a write lands — the
 *  deterministic seam renderScript uses, inlined for tests that also inject stdin. */
async function drainFrame(flush: () => void, writes: string[]): Promise<void> {
  const before = writes.length;
  for (let attempt = 0; attempt < 200 && writes.length === before; attempt++) {
    reconciler.flushSyncWork();
    reconciler.flushPassiveEffects();
    flush();
    if (writes.length === before) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The cursorUp distances (`ESC[nA`) emitted across a set of writes. */
function cursorUpCounts(writes: string[]): number[] {
  const counts: number[] = [];
  const joined = writes.join("");
  // fromCharCode(27) is ESC — keeps the control char out of a regex literal (lint).
  const re = new RegExp(`${String.fromCharCode(27)}\\[(\\d+)A`, "g");
  let m: RegExpExecArray | null = re.exec(joined);
  while (m !== null) {
    counts.push(Number(m[1]));
    m = re.exec(joined);
  }
  return counts;
}

/** Render `node` at `from` dimensions, commit, then resize to `to` and let the
 *  debounce fire. Returns the writes belonging to the resize repaint only. */
async function captureResize(
  node: React.ReactNode,
  from: { columns: number; rows: number },
  to: { columns: number; rows: number },
): Promise<string[]> {
  let splitIdx = 0;
  const all = await withMockedStdout(async (writes) => {
    const { render } = await import("./render");
    const app = render(node);
    await drainFrame(() => app.flush(), writes); // initial frame at `from`
    splitIdx = writes.length;
    Object.defineProperty(process.stdout, "columns", { value: to.columns, configurable: true });
    Object.defineProperty(process.stdout, "rows", { value: to.rows, configurable: true });
    process.stdout.emit("resize");
    // Poll until the debounced (16ms) resize commit lands rather than sleeping a
    // fixed span — a starved CI can push the timer past any constant.
    for (let attempt = 0; attempt < 300 && writes.length === splitIdx; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    app.unmount();
    await app.waitUntilExit();
  }, from);
  return frameWrites(all.slice(splitIdx));
}

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
  test("installs process-level fatal handlers only when onFatalError is given", async () => {
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };

    await withMockedStdout(async () => {
      const { render } = await import("./render");
      // No callback (the default tests use) must never add a process-exiting handler,
      // or a stray rejection anywhere in the suite would kill the runner.
      const bare = render(h("tui-text", null, "x"));
      expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
      expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
      bare.unmount();
      await bare.waitUntilExit();

      const guarded = render(h("tui-text", null, "x"), { onFatalError: () => {} });
      expect(process.listenerCount("uncaughtException")).toBe(before.uncaught + 1);
      expect(process.listenerCount("unhandledRejection")).toBe(before.rejection + 1);
      guarded.unmount();
      await guarded.waitUntilExit();
      // Cleanup removes them — no global handler survives an unmounted render.
      expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
      expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
    });
  });

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

  test("promoting an overflowed turn to static does not duplicate scrollback", async () => {
    // A chat turn whose active region overflows the viewport (top rows freeze into
    // scrollback), then completes and moves into <tui-static> — the exact promotion
    // path. The static flush erases only the live tail, so any frozen line it
    // re-emits would duplicate: it already scrolled off, un-erasable. Driven on the
    // deterministic flush() seam (renderScript) — real timers race the throttle and
    // can skip the overflow frame, silently vacating the pin.
    const LINES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const lineNodes = LINES.map((line) => <tui-text key={line}>{line}</tui-text>);
    const script = [
      <tui-box key="active" flexDirection="column">
        {lineNodes}
        <tui-text>input</tui-text>
      </tui-box>,
      <tui-box key="promoted" flexDirection="column">
        <tui-static>{lineNodes}</tui-static>
        <tui-text>input</tui-text>
      </tui-box>,
    ];
    const frames = await renderScript(script, { columns: 20, rows: 6 });
    const vt = replayTerminal(frameWrites(frames.flat()), 6, 20);
    const transcript = [...vt.scrollback, ...vt.screen];
    for (const line of LINES) {
      const count = transcript.filter((row) => row.includes(line)).length;
      expect(count).toBe(1);
    }
  });

  test("focus-in redraw does not duplicate frozen scrollback", async () => {
    // Focus-in (\x1b[I) triggers forceRedraw. Once the active region has overflowed
    // into scrollback, a from-scratch repaint re-emits the frozen top rows the erase
    // can no longer reach — duplication. forceRedraw must repaint only the live tail.
    const LINES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const stdin = mockStdinTty();
    try {
      const writes = await withMockedStdout(
        async (captured) => {
          const { render } = await import("./render");
          const app = render(
            <tui-box flexDirection="column">
              {LINES.map((line) => (
                <tui-text key={line}>{line}</tui-text>
              ))}
              <tui-text>input</tui-text>
            </tui-box>,
          );
          await drainFrame(() => app.flush(), captured); // initial commit → top rows freeze
          stdin.emit("\x1b[I"); // focus-in → forceRedraw, synchronous commit
          app.unmount();
          await app.waitUntilExit();
        },
        { columns: 20, rows: 6 },
      );

      const vt = replayTerminal(frameWrites(writes), 6, 20);
      const transcript = [...vt.scrollback, ...vt.screen];
      for (const line of LINES) {
        expect(transcript.filter((row) => row.includes(line)).length).toBe(1);
      }
    } finally {
      stdin.restore();
    }
  });

  test("focus-in after a width resize erases the stale tail copy", async () => {
    // A width-change repaint must skip its erase (reflow makes the stored count
    // unsafe), leaving a stale copy of the tail above the new one. When every tail
    // line fits both widths the copy's height is reflow-invariant, so the next
    // same-width erase (here: focus-in) must reclaim it instead of erasing only
    // the newest copy and letting stale blocks accumulate.
    const LINES = ["alpha", "beta", "input"];
    const stdin = mockStdinTty();
    try {
      const writes = await withMockedStdout(
        async (captured) => {
          const { render } = await import("./render");
          const app = render(
            <tui-box flexDirection="column">
              {LINES.map((line) => (
                <tui-text key={line}>{line}</tui-text>
              ))}
            </tui-box>,
          );
          await drainFrame(() => app.flush(), captured);
          const before = captured.length;
          Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true });
          process.stdout.emit("resize");
          for (let attempt = 0; attempt < 300 && captured.length === before; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
          stdin.emit("\x1b[I"); // focus-in → forceRedraw, synchronous commit
          stdin.emit("\x1b[I"); // repeat redraws must stay stable, not re-append
          app.unmount();
          await app.waitUntilExit();
        },
        { columns: 20, rows: 12 },
      );

      const vt = replayTerminal(frameWrites(writes), 12, 30);
      const transcript = [...vt.scrollback, ...vt.screen];
      for (const line of LINES) {
        expect(transcript.filter((row) => row.includes(line)).length).toBe(1);
      }
    } finally {
      stdin.restore();
    }
  });

  test("consecutive width resizes do not strand accumulating stale tail copies", async () => {
    // Each width-change repaint skips its erase and strands a copy of the tail. The
    // debt survives only one transition, so a run of resizes (a slow drag, or an
    // idle tab whose pane keeps reflowing) before any same-width erase would orphan
    // every copy but the last — the input panel stacking on screen. The debt must
    // accumulate so one later same-width erase (focus-in here) reclaims them all.
    // A committed static line sits above the live region: an erase that overshoots
    // the strands (the transcript-loss direction) would eat it and drop its count.
    const COMMITTED = "committed";
    const LINES = ["border-top", "input", "border-bot", "status"];
    const stdin = mockStdinTty();
    try {
      const writes = await withMockedStdout(
        async (captured) => {
          const { render } = await import("./render");
          const app = render(
            <tui-box flexDirection="column">
              <tui-static>
                <tui-text key={COMMITTED}>{COMMITTED}</tui-text>
              </tui-static>
              {LINES.map((line) => (
                <tui-text key={line}>{line}</tui-text>
              ))}
            </tui-box>,
          );
          await drainFrame(() => app.flush(), captured);
          for (const width of [38, 36, 34]) {
            const before = captured.length;
            Object.defineProperty(process.stdout, "columns", { value: width, configurable: true });
            process.stdout.emit("resize");
            for (let attempt = 0; attempt < 300 && captured.length === before; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 2));
            }
          }
          stdin.emit("\x1b[I"); // same-width redraw must reclaim every stranded copy
          app.unmount();
          await app.waitUntilExit();
        },
        { columns: 40, rows: 20 },
      );

      const vt = replayTerminal(frameWrites(writes), 20, 34);
      const transcript = [...vt.scrollback, ...vt.screen];
      for (const line of [COMMITTED, ...LINES]) {
        expect(transcript.filter((row) => row.trim() === line).length).toBe(1);
      }
    } finally {
      stdin.restore();
    }
  });

  test("a live line taller than the viewport is erased before its repaint", async () => {
    // The last live line is never frozen (it may still be streaming), so it owns the
    // tail alone. When it outgrows the viewport the split loop breaks before adding
    // its height, and a stored erase distance of 0 would repaint it below its own
    // stale copy — the whole line twice.
    const ROWS = 10;
    const COLS = 40;
    const tall = "x".repeat(COLS * (ROWS + 3));
    const frames = await renderScript(
      [
        <tui-box key="a" flexDirection="column">
          <tui-text>{tall}</tui-text>
        </tui-box>,
        <tui-box key="b" flexDirection="column">
          <tui-text>{tall}</tui-text>
          <tui-text>after</tui-text>
        </tui-box>,
      ],
      { columns: COLS, rows: ROWS },
    );
    const vt = replayTerminal(frameWrites(frames.flat()), ROWS, COLS);
    const painted = [...vt.scrollback, ...vt.screen].filter((row) => row.includes("x")).length;
    // The repaint reclaims every row still on screen; only the rows that genuinely
    // scrolled off the top survive as a stale prefix.
    expect(painted).toBe(ROWS + 3 + (ROWS + 3 - ROWS));
  });

  test("an edit above the fold repaints the tail without duplicating scrollback", async () => {
    // A long-open turn overflows the viewport, freezing its top rows into scrollback.
    // When a row above the fold then changes in place (a tool row going running->done),
    // the frozen prefix stops matching. Re-emitting the whole region would paint a
    // second copy of every scrolled row; only the unreachable tail may go stale.
    const ROWS = 10;
    const COLS = 40;
    const build = (key: string, marker: string) => {
      const lines = Array.from({ length: 30 }, (_, i) => (i === 2 ? `tool ${marker}` : `row-${i}`));
      return (
        <tui-box key={key} flexDirection="column">
          {lines.map((line) => (
            <tui-text key={line}>{line}</tui-text>
          ))}
        </tui-box>
      );
    };
    const frames = await renderScript([build("a", "running"), build("b", "done")], { columns: COLS, rows: ROWS });
    const vt = replayTerminal(frameWrites(frames.flat()), ROWS, COLS);
    const transcript = [...vt.scrollback, ...vt.screen];
    for (let i = 0; i < 30; i++) {
      if (i === 2) continue; // the tool row, not a "row-N" label
      expect(transcript.filter((row) => row.trim() === `row-${i}`).length).toBe(1);
    }
  });

  test("width-change debt does not erase overflow frozen in the same paint", async () => {
    // A width change arms stale-tail debt (the reflowed copy stranded above the new
    // tail, repaid on the next same-width erase). If that same paint also freezes
    // overflow into scrollback, the stale copy is pushed out of eraseSequence()'s
    // reach — repaying the debt would then cursor-up through the frozen tail and
    // wipe committed transcript. The debt must be dropped when overflow froze.
    const setLines: { current: (value: string[]) => void } = { current: () => {} };
    const many = Array.from({ length: 12 }, (_, i) => `line-${i}`);
    const writes = await withMockedStdout(
      async (buf) => {
        const { render } = await import("./render");
        function App(): React.JSX.Element {
          const [lines, setLinesState] = useState(["prompt", "input"]);
          setLines.current = setLinesState;
          return (
            <tui-box flexDirection="column">
              {lines.map((line) => (
                <tui-text key={line}>{line}</tui-text>
              ))}
            </tui-box>
          );
        }
        const app = render(<App />);
        await drainFrame(() => app.flush(), buf); // frame A: 2-line tail at 20 cols
        Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true });
        setLines.current(many); // frame B: width change + overflow freeze, arms debt
        await drainFrame(() => app.flush(), buf);
        setLines.current([...many, "line-12"]); // frame C: erase must not reach the frozen tail
        await drainFrame(() => app.flush(), buf);
        app.unmount();
        await app.waitUntilExit();
      },
      { columns: 20, rows: 8 },
    );

    const vt = replayTerminal(frameWrites(writes), 8, 30);
    const transcript = [...vt.scrollback, ...vt.screen];
    for (let i = 0; i <= 12; i++) {
      expect(transcript.filter((row) => row.trim() === `line-${i}`).length).toBe(1);
    }
  });

  test("width resize skips the erase and does not re-emit frozen scrollback", async () => {
    // A width change may reflow the tail, so the stored erase count is unsafe.
    const LINES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const resize = await captureResize(
      <tui-box flexDirection="column">
        {LINES.map((line) => (
          <tui-text key={line}>{line}</tui-text>
        ))}
        <tui-text>input</tui-text>
      </tui-box>,
      { columns: 20, rows: 6 },
      { columns: 30, rows: 6 },
    );
    const joined = resize.join("");
    expect(cursorUpCounts(resize)).toEqual([]);
    expect(joined).not.toContain(ansi.eraseDown);
    expect(joined).not.toContain("L1"); // L1 is the frozen top — must not reappear
  });

  test("height-only resize still erases the live tail", async () => {
    // Width unchanged → no reflow → the stored erase count stays valid.
    const resize = await captureResize(
      <tui-box flexDirection="column">
        <tui-text>alpha</tui-text>
        <tui-text>beta</tui-text>
      </tui-box>,
      { columns: 20, rows: 10 },
      { columns: 20, rows: 8 },
    );
    expect(cursorUpCounts(resize).length).toBeGreaterThan(0);
    expect(resize.join("")).toContain(ansi.eraseDown);
  });

  test("height-shrink resize clamps the erase to the viewport, keeping frozen", async () => {
    const LINES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const resize = await captureResize(
      <tui-box flexDirection="column">
        {LINES.map((line) => (
          <tui-text key={line}>{line}</tui-text>
        ))}
        <tui-text>input</tui-text>
      </tui-box>,
      { columns: 20, rows: 6 },
      { columns: 20, rows: 4 },
    );
    // Erase distance can never exceed the new viewport's top row (rows - 1 = 3),
    // else cursor-up reaches through the top into frozen history.
    expect(cursorUpCounts(resize).every((n) => n <= 3)).toBe(true);
    expect(resize.join("")).not.toContain("L1"); // L1 is the frozen top — must not reappear
  });

  test("width change before the resize debounce skips the erase (loss guard)", async () => {
    // A streaming commit can land after stdout.columns changed but before the
    // 16ms resize debounce fires. The geometry guard lives in commitRender, so
    // even this state-driven commit must skip the now-invalid erase.
    const setText: { current: (value: string) => void } = { current: () => {} };
    await withMockedStdout(
      async (writes) => {
        const { render } = await import("./render");
        function App(): React.JSX.Element {
          const [text, setTextState] = useState("one");
          setText.current = setTextState;
          // Multi-line so lastActiveLineCount > 0 — without the guard the "two"
          // commit would erase (cursorUp), which is exactly what must be skipped.
          return (
            <tui-box flexDirection="column">
              <tui-text>alpha</tui-text>
              <tui-text>beta</tui-text>
              <tui-text>{text}</tui-text>
            </tui-box>
          );
        }
        const app = render(<App />);
        await drainFrame(() => app.flush(), writes);
        const before = writes.length;
        Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });
        setText.current("two"); // drives a commit directly, not via the resize debounce
        await drainFrame(() => app.flush(), writes);
        const frame = writes.slice(before);
        expect(frame.join("")).toContain("two");
        expect(cursorUpCounts(frame)).toEqual([]);
        app.unmount();
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );
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

  test("terminal-width boxes resolve their width again on resize", async () => {
    for (const [from, to] of [
      [80, 60],
      [60, 80],
    ] as const) {
      const writes = await captureResize(
        <tui-box justifyContent="space-between" width="terminal">
          <tui-text>left</tui-text>
          <tui-text>right</tui-text>
        </tui-box>,
        { columns: from, rows: 24 },
        { columns: to, rows: 24 },
      );
      expect(writes.join("")).toContain(`left${" ".repeat(to - 9)}right`);
    }
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

  test("promoting an overflowed turn whose above-fold row changed does not duplicate scrollback", async () => {
    // Finding #1: a non-finalized row (tool running) sits above a screenful, freezes into
    // scrollback, then finalizes (tool done) in the same frame its section commits to
    // <tui-static>. A byte-match adoption misses the change and re-emits the whole slice
    // below its frozen copy; adopting the frozen prefix by physical-line count avoids it.
    const build = (marker: string, promoted: boolean) => {
      const lines = ["L1", "L2", `tool ${marker}`, "L4", "L5", "L6", "L7", "L8"];
      const nodes = lines.map((line) => <tui-text key={line}>{line}</tui-text>);
      return promoted ? (
        <tui-box key="p" flexDirection="column">
          <tui-static>{nodes}</tui-static>
          <tui-text>input</tui-text>
        </tui-box>
      ) : (
        <tui-box key="a" flexDirection="column">
          {nodes}
          <tui-text>input</tui-text>
        </tui-box>
      );
    };
    const frames = await renderScript([build("running", false), build("done", true)], { columns: 20, rows: 6 });
    const vt = replayTerminal(frameWrites(frames.flat()), 6, 20);
    const transcript = [...vt.scrollback, ...vt.screen];
    for (const line of ["L1", "L2", "L4", "L5", "L6", "L7", "L8"]) {
      expect(transcript.filter((row) => row.includes(line)).length).toBe(1);
    }
  });

  test("a static flush with no frozen overlap keeps every committed line", async () => {
    // The count-based adoption must not over-skip: a fresh static item flushed while the
    // renderer still holds a frozen overflow prefix from an unrelated live region (a
    // /clear seeding a new header mid-overflow) must be written in full, not truncated.
    const HEADER = ["H1", "H2", "H3", "H4"];
    const build = (withHeader: boolean) => (
      <tui-box key={withHeader ? "h" : "a"} flexDirection="column">
        {withHeader && (
          <tui-static>
            {HEADER.map((line) => (
              <tui-text key={line}>{line}</tui-text>
            ))}
          </tui-static>
        )}
        {["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"].map((line) => (
          <tui-text key={line}>{line}</tui-text>
        ))}
      </tui-box>
    );
    const frames = await renderScript([build(false), build(true)], { columns: 20, rows: 6 });
    const vt = replayTerminal(frameWrites(frames.flat()), 6, 20);
    const transcript = [...vt.scrollback, ...vt.screen];
    for (const line of HEADER) {
      expect(transcript.filter((row) => row.trim() === line).length).toBe(1);
    }
  });

  test("clearTerminal resets frozen state so a later static flush is not truncated", async () => {
    // openSegment (/clear, session switch) wipes scrollback through clearTerminal. If the
    // renderer kept its frozen-overflow count across the wipe, the count-based adoption
    // would skip that many lines off the fresh segment's header — dropping its top rows.
    const { clearTerminal } = await import("./host-config");
    const HEADER = ["H1", "H2", "H3", "H4"];
    const LIVE = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"];
    const postClear: string[] = [];
    // A synchronous external store (as renderScript uses) so the segment swap commits in
    // one deterministic frame — a ref-driven setState is default priority and would not
    // flush under the manual drain, letting the wipe race the commit.
    let cleared = false;
    const listeners = new Set<() => void>();
    const store = {
      get: () => cleared,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    await withMockedStdout(
      async (buf) => {
        const { render } = await import("./render");
        function App(): React.JSX.Element {
          const c = useSyncExternalStore(store.subscribe, store.get);
          return (
            <tui-box flexDirection="column">
              <tui-static>{c && HEADER.map((line) => <tui-text key={line}>{line}</tui-text>)}</tui-static>
              {!c && LIVE.map((line) => <tui-text key={line}>{line}</tui-text>)}
            </tui-box>
          );
        }
        const app = render(<App />);
        await drainFrame(() => app.flush(), buf); // V1..V3 overflow and freeze
        const mark = buf.length;
        // openSegment wipes the terminal, then swaps in the new segment's rows: the wipe's
        // frozen-state reset must land before the swap commits.
        cleared = true;
        clearTerminal();
        for (const listener of listeners) listener();
        await drainFrame(() => app.flush(), buf);
        postClear.push(...buf.slice(mark));
        app.unmount();
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );

    // The fresh segment header must be written in full after the wipe. With the frozen
    // count left stale, count-based adoption would drop its top rows, emitting only H4.
    const emitted = postClear.join("");
    for (const line of HEADER) {
      expect(emitted).toContain(line);
    }
  });

  test("a promotion after a width change writes committed lines in full, never dropping them", async () => {
    // The frozen line count is measured in the freeze frame's width. After a resize the
    // committed slice rewraps to a different line count, so dropping that stale count would
    // remove more lines than the widened content holds — silent transcript loss. Adoption is
    // gated on the width matching the freeze; a mismatch falls back to a byte match, which
    // dedups an unchanged prefix but never drops content.
    const NARROW = ["N0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"];
    const WIDE = ["W0", "W1", "W2", "W3", "W4"];
    let promoted = false;
    const listeners = new Set<() => void>();
    const store = {
      get: () => promoted,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const postResize: string[] = [];
    await withMockedStdout(
      async (buf) => {
        const { render } = await import("./render");
        function App(): React.JSX.Element {
          const p = useSyncExternalStore(store.subscribe, store.get);
          return (
            <tui-box flexDirection="column">
              <tui-static>{p && WIDE.map((line) => <tui-text key={line}>{line}</tui-text>)}</tui-static>
              {!p && NARROW.map((line) => <tui-text key={line}>{line}</tui-text>)}
            </tui-box>
          );
        }
        const app = render(<App />);
        await drainFrame(() => app.flush(), buf); // freeze the top narrow lines at 20 cols
        Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });
        promoted = true;
        for (const listener of listeners) listener();
        const mark = buf.length;
        await drainFrame(() => app.flush(), buf);
        postResize.push(...buf.slice(mark));
        app.unmount();
        await app.waitUntilExit();
      },
      { columns: 20, rows: 6 },
    );

    const emitted = postResize.join("");
    for (const line of WIDE) {
      expect(emitted).toContain(line);
    }
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
