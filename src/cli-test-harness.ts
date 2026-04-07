import { stripAnsi } from "./tui/serialize";
import { trimRightLines } from "./tui-test-utils";
import { setUiSink } from "./ui";

let isCapturingCliOutput = false;

export async function captureCliOutput(fn: () => Promise<void> | void): Promise<string> {
  if (isCapturingCliOutput) {
    throw new Error("captureCliOutput cannot be nested");
  }
  isCapturingCliOutput = true;

  const chunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  setUiSink((chunk) => {
    chunks.push(chunk);
  });

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;

  try {
    await fn();
  } finally {
    setUiSink(null);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    isCapturingCliOutput = false;
  }

  return trimRightLines(stripAnsi(chunks.join("")))
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}
