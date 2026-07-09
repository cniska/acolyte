import { describe, expect, test } from "bun:test";
import { gitStatus } from "./chat-layout";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockGit(responses: Record<string, { stdout: string; exit?: number }>): typeof Bun.spawn {
  return ((options: { cmd: string[] }) => {
    const key = options.cmd.join(" ");
    const response = responses[key] ?? { stdout: "", exit: 128 };
    return {
      stdout: streamFromText(response.stdout),
      stderr: streamFromText(""),
      exited: Promise.resolve(response.exit ?? 0),
    } as Bun.Subprocess;
  }) as typeof Bun.spawn;
}

async function withMockedGit<T>(responses: Parameters<typeof mockGit>[0], run: () => Promise<T>): Promise<T> {
  const original = Bun.spawn;
  (Bun as { spawn: typeof Bun.spawn }).spawn = mockGit(responses);
  try {
    return await run();
  } finally {
    (Bun as { spawn: typeof Bun.spawn }).spawn = original;
  }
}

describe("gitStatus", () => {
  test("returns null outside a git repository", async () => {
    const result = await withMockedGit({}, () => gitStatus("/tmp/not-a-repo"));
    expect(result).toBeNull();
  });

  test("reports a clean branch with no upstream divergence", async () => {
    const result = await withMockedGit(
      {
        "git rev-parse --absolute-git-dir": { stdout: "/tmp/mock-repo/.git\n" },
        "git --no-optional-locks status --porcelain=v2 --branch": {
          stdout: "# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n",
        },
      },
      () => gitStatus("/tmp/mock-repo"),
    );
    expect(result).toEqual({ repo: "mock-repo", worktree: null, branch: "main", dirty: false, ahead: 0, behind: 0 });
  });

  test("reports dirty and ahead/behind counts", async () => {
    const result = await withMockedGit(
      {
        "git rev-parse --absolute-git-dir": { stdout: "/tmp/mock-repo/.git\n" },
        "git --no-optional-locks status --porcelain=v2 --branch": {
          stdout: "# branch.head main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 abc def src/x.ts\n",
        },
      },
      () => gitStatus("/tmp/mock-repo"),
    );
    expect(result).toEqual({ repo: "mock-repo", worktree: null, branch: "main", dirty: true, ahead: 2, behind: 1 });
  });

  test("reports the worktree name and the main repo name inside a linked worktree", async () => {
    const result = await withMockedGit(
      {
        "git rev-parse --absolute-git-dir": { stdout: "/tmp/mock-repo/.git/worktrees/feature\n" },
        "git --no-optional-locks status --porcelain=v2 --branch": {
          stdout: "# branch.head feature\n",
        },
      },
      () => gitStatus("/tmp/mock-repo"),
    );
    expect(result).toEqual({
      repo: "mock-repo",
      worktree: "feature",
      branch: "feature",
      dirty: false,
      ahead: 0,
      behind: 0,
    });
  });

  test("falls back to the short SHA on a detached HEAD", async () => {
    const result = await withMockedGit(
      {
        "git rev-parse --absolute-git-dir": { stdout: "/tmp/mock-repo/.git\n" },
        "git --no-optional-locks status --porcelain=v2 --branch": { stdout: "# branch.head (detached)\n" },
        "git rev-parse --short HEAD": { stdout: "deadbee\n" },
      },
      () => gitStatus("/tmp/mock-repo"),
    );
    expect(result?.branch).toBe("deadbee");
  });

  test("leaves branch null when detached and the SHA lookup also fails", async () => {
    const result = await withMockedGit(
      {
        "git rev-parse --absolute-git-dir": { stdout: "/tmp/mock-repo/.git\n" },
        "git --no-optional-locks status --porcelain=v2 --branch": { stdout: "# branch.head (detached)\n" },
        "git rev-parse --short HEAD": { stdout: "", exit: 128 },
      },
      () => gitStatus("/tmp/mock-repo"),
    );
    expect(result).toEqual({ repo: "mock-repo", worktree: null, branch: null, dirty: false, ahead: 0, behind: 0 });
  });
});
