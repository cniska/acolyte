import { afterEach, describe, expect, test } from "bun:test";
import { stdout } from "node:process";
import {
  BRAILLE_BLANK,
  BRAND_MARK_GAP,
  BRAND_MARK_ROWS,
  BRAND_WORDMARK_GAP,
  BRAND_WORDMARK_LOCKUP_WIDTH,
  BRAND_WORDMARK_ROWS,
  BRAND_WORDMARK_WIDTH,
} from "./brand-mark";
import { formatCliBanner, printDim, printOutput, setUiSink, tokenizeStreamContent } from "./ui";

describe("ui stream helpers", () => {
  test("tokenizeStreamContent preserves whitespace tokens including newlines", () => {
    const tokens = tokenizeStreamContent("• 1. first\n2. second");
    expect(tokens).toEqual(["•", " ", "1.", " ", "first", "\n", "2.", " ", "second"]);
  });
});

const ESC = String.fromCharCode(27);

const WIDE_TERMINAL = 120;

function captureWith(isTty: boolean, noColor: string | undefined, write: () => void, columns = WIDE_TERMINAL): string {
  const chunks: string[] = [];
  const originalIsTty = stdout.isTTY;
  const originalColumns = stdout.columns;
  const originalNoColor = process.env.NO_COLOR;
  Object.defineProperty(stdout, "isTTY", { value: isTty, configurable: true });
  Object.defineProperty(stdout, "columns", { value: columns, configurable: true });
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  setUiSink((chunk) => chunks.push(chunk));
  try {
    write();
  } finally {
    setUiSink(null);
    Object.defineProperty(stdout, "isTTY", { value: originalIsTty, configurable: true });
    Object.defineProperty(stdout, "columns", { value: originalColumns, configurable: true });
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

describe("cli banner", () => {
  const CARET_WIDTH = 4;
  const edge = CARET_WIDTH + BRAND_WORDMARK_GAP.length + BRAND_WORDMARK_WIDTH;
  // The banner reads the ambient terminal, so without the capture pinning width and tty these
  // tests would pick up the escapes a real terminal gets and the shape a narrow one falls to.
  const rowsOf = (version: string, columns?: number): string[] => {
    const written = captureWith(false, undefined, () => printOutput(formatCliBanner(version)), columns);
    const rows = written.split("\n");
    rows.pop();
    return rows;
  };
  const lastLine = (version: string): string => rowsOf(version).at(-1) ?? "";

  test("the width the narrow fallback triggers on is the caret, the gap and the lettering", () => {
    expect(BRAND_WORDMARK_LOCKUP_WIDTH).toBe(edge);
  });

  test("the version ends flush with the lettering's right edge whatever its length", () => {
    for (const version of ["1.0.0", "0.27.2", "0.100.0", "1.2.3-rc.4"]) {
      expect(lastLine(version).length).toBe(edge);
    }
  });

  test("a terminal exactly as wide as the lockup still gets the wordmark", () => {
    expect(rowsOf("0.27.2", BRAND_WORDMARK_LOCKUP_WIDTH)).toHaveLength(BRAND_WORDMARK_ROWS.length);
  });

  test("a narrower terminal gets the square mark, naming itself in text beside it", () => {
    const rows = rowsOf("0.27.2", BRAND_WORDMARK_LOCKUP_WIDTH - 1);
    expect(rows).toHaveLength(BRAND_MARK_ROWS.length);
    expect(rows[0]).toBe(`${BRAND_MARK_ROWS[0].chevron}${BRAND_MARK_GAP}${BRAND_MARK_ROWS[0].letter}   Acolyte`);
    expect(rows[1]).toEndWith("v0.27.2");
  });

  test("the square mark fits a terminal far narrower than the wordmark", () => {
    const rows = rowsOf("0.27.2", 30);
    expect(Math.max(...rows.map((row) => row.length))).toBeLessThanOrEqual(30);
  });

  test("a version wider than the mark still renders rather than padding negatively", () => {
    expect(lastLine("0.0.0-a-very-long-prerelease-tag")).toEndWith("v0.0.0-a-very-long-prerelease-tag");
  });

  test("a terminal gets the monochrome sweep, brightest on the top row", () => {
    const written = captureWith(true, undefined, () => printOutput(formatCliBanner("0.27.2")));
    const rows = written.trimEnd().split("\n");
    expect(rows[0]).toContain(`${ESC}[38;2;245;245;245m`);
    expect(rows.at(-1)).toContain(`${ESC}[38;2;163;163;163m`);
  });

  test("an all-blank run stays unpainted, so the caret's empty rows carry no escapes", () => {
    const written = captureWith(true, undefined, () => printOutput(formatCliBanner("0.27.2")));
    expect(written.split("\n")[0]).toStartWith(BRAILLE_BLANK);
  });

  test("a redirected stream gets bare cells", () => {
    const plain = captureWith(false, undefined, () => printOutput(formatCliBanner("0.27.2")));
    expect(plain).not.toContain(ESC);
  });
});
