import { describe, expect, test } from "bun:test";
import { createGitOps, type GitOpsDeps } from "./git-toolkit";

function createDeps(overrides?: Partial<GitOpsDeps>): GitOpsDeps {
  return {
    gitDiff: overrides?.gitDiff ?? (async () => "diff"),
    gitLog: overrides?.gitLog ?? (async () => "log"),
    gitShow: overrides?.gitShow ?? (async () => "show"),
    gitAdd: overrides?.gitAdd ?? (async () => "staged"),
    gitCommit: overrides?.gitCommit ?? (async () => "committed"),
  };
}

describe("git toolkit", () => {
  test("forwards workspace and defaults for diff/log/show", async () => {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const deps = createDeps({
      gitDiff: async (...args) => {
        calls.push({ op: "diff", args });
        return "diff";
      },
      gitLog: async (...args) => {
        calls.push({ op: "log", args });
        return "log";
      },
      gitShow: async (...args) => {
        calls.push({ op: "show", args });
        return "show";
      },
    });
    const toolkit = createGitOps("/repo", deps);

    await toolkit.diff();
    await toolkit.log();
    await toolkit.show();

    expect(calls).toEqual([
      { op: "diff", args: ["/repo", undefined, 3] },
      { op: "log", args: ["/repo", { path: undefined, limit: undefined }] },
      { op: "show", args: ["/repo", { ref: undefined, path: undefined, contextLines: 3 }] },
    ]);
  });

  test("forwards explicit arguments to git operations", async () => {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const deps = createDeps({
      gitDiff: async (...args) => {
        calls.push({ op: "diff", args });
        return "diff";
      },
      gitLog: async (...args) => {
        calls.push({ op: "log", args });
        return "log";
      },
      gitShow: async (...args) => {
        calls.push({ op: "show", args });
        return "show";
      },
    });
    const toolkit = createGitOps("/repo", deps);

    await toolkit.diff({ path: "src/a.ts", contextLines: 7 });
    await toolkit.log({ path: "src/a.ts", limit: 4 });
    await toolkit.show({ ref: "HEAD~1", path: "src/a.ts", contextLines: 2 });

    expect(calls).toEqual([
      { op: "diff", args: ["/repo", "src/a.ts", 7] },
      { op: "log", args: ["/repo", { path: "src/a.ts", limit: 4 }] },
      { op: "show", args: ["/repo", { ref: "HEAD~1", path: "src/a.ts", contextLines: 2 }] },
    ]);
  });

  test("prefixes errors with operation context", async () => {
    const toolkit = createGitOps(
      "/repo",
      createDeps({
        gitDiff: async () => {
          throw new Error("boom");
        },
      }),
    );

    await expect(toolkit.diff()).rejects.toThrow("[git-ops:diff] boom");
  });
});
