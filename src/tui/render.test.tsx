import { describe, expect, test } from "bun:test";
import type React from "react";
import { createElement as h, useEffect, useState } from "react";
import { ChatInputPanel } from "../chat-input-panel";
import { ansi } from "./styles";

function withMockedStdout(
  fn: (writes: string[]) => void | Promise<void>,
  options: { columns?: number; rows?: number; stdinTty?: boolean } = {},
): Promise<string[]> {
  const writes: string[] = [];
  const columns = options.columns ?? 120;
  const rows = options.rows ?? 24;
  const saved = {
    write: process.stdout.write,
    isTTY: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    columns: Object.getOwnPropertyDescriptor(process.stdout, "columns"),
    rows: Object.getOwnPropertyDescriptor(process.stdout, "rows"),
    stdinIsTTY: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
    stdinSetRawMode: process.stdin.setRawMode,
    stdinResume: process.stdin.resume,
    stdinPause: process.stdin.pause,
  };
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
  if (options.stdinTty) {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    process.stdin.setRawMode = (() => process.stdin) as typeof process.stdin.setRawMode;
    process.stdin.resume = (() => process.stdin) as typeof process.stdin.resume;
    process.stdin.pause = (() => process.stdin) as typeof process.stdin.pause;
  }
  process.stdout.write = ((data: string) => {
    writes.push(data);
    return true;
  }) as typeof process.stdout.write;

  const restoreOwnProperty = (target: object, key: string, descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
      return;
    }
    Reflect.deleteProperty(target, key);
  };

  const restore = () => {
    process.stdout.write = saved.write;
    for (const key of ["isTTY", "columns", "rows"] as const) {
      restoreOwnProperty(process.stdout, key, saved[key]);
    }
    restoreOwnProperty(process.stdin, "isTTY", saved.stdinIsTTY);
    process.stdin.setRawMode = saved.stdinSetRawMode;
    process.stdin.resume = saved.stdinResume;
    process.stdin.pause = saved.stdinPause;
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
        } else if (finalByte === "H") {
          const [rowText, colText] = paramText.split(";");
          const nextRow = Number.parseInt(rowText ?? "1", 10);
          const nextCol = Number.parseInt(colText ?? "1", 10);
          row = Math.max(0, Math.min(rows - 1, (Number.isFinite(nextRow) ? nextRow : 1) - 1));
          col = Math.max(0, Math.min(columns - 1, (Number.isFinite(nextCol) ? nextCol : 1) - 1));
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

function replayScrollback(writes: string[], rows: number, columns: number): string[] {
  const screen = Array.from({ length: rows }, () => Array.from({ length: columns }, () => " "));
  const scrollback: string[] = [];
  let row = 0;
  let col = 0;

  const scroll = (): void => {
    const first = screen.shift();
    scrollback.push((first ?? []).join("").trimEnd());
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
        if (finalByte === "A") {
          const param = paramText.length > 0 ? Number.parseInt(paramText, 10) : 1;
          row = Math.max(0, row - (Number.isFinite(param) ? param : 1));
        } else if (finalByte === "J") {
          eraseDown();
        } else if (finalByte === "H") {
          const [rowText, colText] = paramText.split(";");
          const nextRow = Number.parseInt(rowText ?? "1", 10);
          const nextCol = Number.parseInt(colText ?? "1", 10);
          row = Math.max(0, Math.min(rows - 1, (Number.isFinite(nextRow) ? nextRow : 1) - 1));
          col = Math.max(0, Math.min(columns - 1, (Number.isFinite(nextCol) ? nextCol : 1) - 1));
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
  return scrollback;
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

        function App(): React.JSX.Element {
          const [lines, setLines] = useState(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);

          useEffect(() => {
            const updateTimer = setTimeout(() => {
              setLines(["B1", "B2", "B3", "B4"]);
            }, 20);
            const unmountTimer = setTimeout(() => {
              app.unmount();
            }, 60);
            return () => {
              clearTimeout(updateTimer);
              clearTimeout(unmountTimer);
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

    const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
    const frameWrites = cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
    const visible = replayVisibleScreen(frameWrites, 6, 20);
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

        function App(): React.JSX.Element {
          const [lines, setLines] = useState(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);

          useEffect(() => {
            const updateTimer = setTimeout(() => {
              setLines(["B1", "B2", "B3", "B4"]);
            }, 20);
            const unmountTimer = setTimeout(() => {
              app.unmount();
            }, 60);
            return () => {
              clearTimeout(updateTimer);
              clearTimeout(unmountTimer);
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

    const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
    const frameWrites = cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
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

    const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
    const frameWrites = cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
    const allOutput = frameWrites.join("");

    // HEADER must appear exactly once — never duplicated by forceRedraw.
    const headerCount = allOutput.split("HEADER").length - 1;
    expect(headerCount).toBe(1);
  });

  test("focus-in redraw does not duplicate static transcript in scrollback", async () => {
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          useEffect(() => {
            const focusTimer = setTimeout(() => {
              process.stdin.emit("data", Buffer.from("\x1b[I"));
            }, 20);
            const unmountTimer = setTimeout(() => {
              app.unmount();
            }, 60);
            return () => {
              clearTimeout(focusTimer);
              clearTimeout(unmountTimer);
            };
          }, []);

          return (
            <tui-box flexDirection="column">
              <tui-static>
                <tui-text>HEADER_FOCUS</tui-text>
                <tui-text>line 1</tui-text>
                <tui-text>line 2</tui-text>
                <tui-text>line 3</tui-text>
                <tui-text>line 4</tui-text>
                <tui-text>line 5</tui-text>
                <tui-text>line 6</tui-text>
                <tui-text>line 7</tui-text>
                <tui-text>line 8</tui-text>
                <tui-text>line 9</tui-text>
              </tui-static>
              <tui-text>active prompt</tui-text>
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns: 40, rows: 6, stdinTty: true },
    );

    const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
    const frameWrites = cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
    const scrollback = replayScrollback(frameWrites, 6, 40).join("\n");
    const headerCount = scrollback.split("HEADER_FOCUS").length - 1;
    expect(headerCount).toBe(1);
  });

  test("focus-in redraw preserves visible viewport placement", async () => {
    const rows = 8;
    const columns = 40;
    const writes = await withMockedStdout(
      async () => {
        const { render } = await import("./render");

        function App(): React.JSX.Element {
          useEffect(() => {
            const focusTimer = setTimeout(() => {
              process.stdin.emit("data", Buffer.from("\x1b[I"));
            }, 20);
            const unmountTimer = setTimeout(() => {
              app.unmount();
            }, 60);
            return () => {
              clearTimeout(focusTimer);
              clearTimeout(unmountTimer);
            };
          }, []);

          return (
            <tui-box flexDirection="column">
              <tui-static>
                <tui-text>S1</tui-text>
                <tui-text>S2</tui-text>
                <tui-text>S3</tui-text>
                <tui-text>S4</tui-text>
                <tui-text>S5</tui-text>
                <tui-text>S6</tui-text>
                <tui-text>S7</tui-text>
              </tui-static>
              <tui-text>A1</tui-text>
              <tui-text>A2</tui-text>
              <tui-text>A3</tui-text>
              <tui-text>INPUT</tui-text>
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns, rows, stdinTty: true },
    );

    const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
    const frameWrites = cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
    const inputWriteIndices = frameWrites
      .map((write, index) => (write.includes("INPUT") ? index : -1))
      .filter((index) => index >= 0);
    expect(inputWriteIndices.length).toBeGreaterThanOrEqual(2);
    const firstInputWrite = inputWriteIndices[0] ?? 0;
    const secondInputWrite = inputWriteIndices[1] ?? 0;
    const before = replayVisibleScreen(frameWrites.slice(0, firstInputWrite + 1), rows, columns).join("\n");
    const after = replayVisibleScreen(frameWrites.slice(0, secondInputWrite + 1), rows, columns).join("\n");
    expect(after).toBe(before);
  });

  test("focus-in redraw does not pin short content to terminal top", async () => {
    const rows = 8;
    const columns = 40;
    const writes = await withMockedStdout(
      async () => {
        // Simulate existing scrollback before the TUI starts.
        for (let i = 1; i <= 20; i++) process.stdout.write(`PRE${i}\n`);

        const { render } = await import("./render");
        function App(): React.JSX.Element {
          useEffect(() => {
            const focusTimer = setTimeout(() => {
              process.stdin.emit("data", Buffer.from("\x1b[I"));
            }, 20);
            const unmountTimer = setTimeout(() => {
              app.unmount();
            }, 60);
            return () => {
              clearTimeout(focusTimer);
              clearTimeout(unmountTimer);
            };
          }, []);
          return (
            <tui-box flexDirection="column">
              <tui-text>line A</tui-text>
              <tui-text>line B</tui-text>
              <tui-text>INPUT</tui-text>
            </tui-box>
          );
        }

        const app = render(<App />);
        await app.waitUntilExit();
      },
      { columns, rows, stdinTty: true },
    );

    const cleanupStart = writes.findIndex((write) => write.includes(ansi.cursorShow));
    const frameWrites = cleanupStart >= 0 ? writes.slice(0, cleanupStart) : writes;
    const visible = replayVisibleScreen(frameWrites, rows, columns).join("\n");
    const topLine = visible.split("\n")[0] ?? "";
    expect(topLine.startsWith("PRE")).toBe(true);
  });
});
