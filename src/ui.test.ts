import { describe, expect, test } from "bun:test";
import { clearScreen, setUiSink } from "./ui";

describe("ui", () => {
  test("clearScreen clears scrollback and viewport", () => {
    const chunks: string[] = [];
    setUiSink((chunk) => {
      chunks.push(chunk);
    });
    try {
      clearScreen();
    } finally {
      setUiSink(null);
    }
    expect(chunks).toEqual(["\x1b[3J\x1b[2J\x1b[H"]);
  });
});
