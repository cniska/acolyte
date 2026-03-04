import { describe, expect, test } from "bun:test";
import { formatHeaderContextLine, justifyLineSpaceBetween, shownBranch } from "./chat-layout";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function withColumns(width: number, task: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
  try {
    task();
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
    else delete (process.stdout as { columns?: number }).columns;
  }
}

describe("chat-layout", () => {
  test("formatHeaderContextLine composes workspace and branch", () => {
    expect(formatHeaderContextLine("~/code/acolyte", "main")).toBe("~/code/acolyte · main");
    expect(formatHeaderContextLine("~/code/acolyte", null)).toBe("~/code/acolyte · —");
  });

  test("shownBranch returns null outside git repositories", async () => {
    const originalSpawn = Bun.spawn;
    (Bun as { spawn: typeof Bun.spawn }).spawn = (() =>
      ({
        stdout: streamFromText(""),
        stderr: streamFromText("fatal: not a git repository\n"),
        exited: Promise.resolve(128),
      }) as Bun.Subprocess) as typeof Bun.spawn;
    try {
      expect(await shownBranch("/tmp/mock-repo")).toBeNull();
    } finally {
      (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("shownBranch returns a branch name inside a git repository", async () => {
    const originalSpawn = Bun.spawn;
    (Bun as { spawn: typeof Bun.spawn }).spawn = (() =>
      ({
        stdout: streamFromText("main\n"),
        stderr: streamFromText(""),
        exited: Promise.resolve(0),
      }) as Bun.Subprocess) as typeof Bun.spawn;
    try {
      expect(await shownBranch("/tmp/mock-repo")).toBe("main");
    } finally {
      (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("justifyLineSpaceBetween keeps help left and context right", () => {
    withColumns(40, () => {
      expect(justifyLineSpaceBetween("? help", "acolyte · main")).toBe(
        "? help                    acolyte · main",
      );
    });
  });

  test("justifyLineSpaceBetween falls back when line is too narrow", () => {
    withColumns(10, () => {
      expect(justifyLineSpaceBetween("? help", "acolyte · main")).toBe(
        "? help · acolyte · main",
      );
    });
  });
});
