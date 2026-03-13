import { describe, expect, test } from "bun:test";
import { shownBranch } from "./chat-layout";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("chat-layout", () => {
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
});
