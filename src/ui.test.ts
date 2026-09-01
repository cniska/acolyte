import { afterEach, describe, expect, test } from "bun:test";
import { stdout } from "node:process";
import { printDim, printOutput, setUiSink, tokenizeStreamContent } from "./ui";

describe("ui stream helpers", () => {
  test("tokenizeStreamContent preserves whitespace tokens including newlines", () => {
    const tokens = tokenizeStreamContent("• 1. first\n2. second");
    expect(tokens).toEqual(["•", " ", "1.", " ", "first", "\n", "2.", " ", "second"]);
  });
});

const ESC = String.fromCharCode(27);

function captureWith(isTty: boolean, noColor: string | undefined, write: () => void): string {
  const chunks: string[] = [];
  const originalIsTty = stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;
  Object.defineProperty(stdout, "isTTY", { value: isTty, configurable: true });
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  setUiSink((chunk) => chunks.push(chunk));
  try {
    write();
  } finally {
    setUiSink(null);
    Object.defineProperty(stdout, "isTTY", { value: originalIsTty, configurable: true });
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  }
  return chunks.join("");
}

describe("ui color suppression", () => {
  afterEach(() => setUiSink(null));

  test("a terminal gets the dim escapes", () => {
    const written = captureWith(true, undefined, () => printDim("hello"));
    expect(written).toBe(`${ESC}[2mhello${ESC}[22m\n`);
  });

  test("a redirected stream gets no escapes", () => {
    const written = captureWith(false, undefined, () => printDim("hello"));
    expect(written).toBe("hello\n");
  });

  test("NO_COLOR strips the escapes on a terminal", () => {
    const written = captureWith(true, "1", () => printDim("hello"));
    expect(written).toBe("hello\n");
  });

  test("printOutput never colors its content", () => {
    const written = captureWith(true, undefined, () => printOutput('{"event":"lifecycle.start"}'));
    expect(written).toBe('{"event":"lifecycle.start"}\n');
  });
});
