import { describe, expect, test } from "bun:test";
import { invariant } from "./assert";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { createToolCache } from "./tool-cache";
import { runTool, withToolError } from "./tool-execution";
import { createSessionContext } from "./tool-session";

describe("withToolError", () => {
  test("prefixes thrown errors with tool id", async () => {
    await expect(withToolError("file-read", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "file-read failed: boom",
    );
  });

  test("preserves structured error code on wrapped errors", async () => {
    const source = Object.assign(new Error("multi-match"), { code: "E_EDIT_FILE_MULTI_MATCH" });
    try {
      await withToolError("file-edit", async () => Promise.reject(source));
      invariant(false, "expected withToolError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error & { code?: string };
      expect(wrapped.message).toBe("file-edit failed: multi-match");
      expect(wrapped.code).toBe("E_EDIT_FILE_MULTI_MATCH");
    }
  });
});

describe("per-tool timeout", () => {
  test("rejects with timeout error when tool exceeds limit", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 50;
    try {
      await runTool(session, "slow-tool", "call_1", {}, () => new Promise((resolve) => setTimeout(resolve, 500)));
      invariant(false, "expected timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const typed = error as Error & { code?: string };
      expect(typed.code).toBe(LIFECYCLE_ERROR_CODES.timeout);
      expect(typed.message).toContain("timed out");
    }
  });

  test("resolves normally when tool completes within limit", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    const result = await runTool(session, "fast-tool", "call_1", {}, async () => "done");
    expect(result).toEqual({ result: "done" });
  });

  test("returns effectOutput from lifecycle hooks", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    session.onAfterTool = () => ({ append: "Lint errors:\nsrc/foo.ts:1 missing semicolon" });
    const result = await runTool(session, "file-edit", "call_1", {}, async () => ({ ok: true }));
    expect(result.result).toEqual({ ok: true });
    expect(result.effectOutput).toBe("Lint errors:\nsrc/foo.ts:1 missing semicolon");
  });

  test("omits effectOutput when lifecycle hooks return no feedback", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    session.onAfterTool = () => undefined;
    const result = await runTool(session, "file-edit", "call_1", {}, async () => ({ ok: true }));
    expect(result.result).toEqual({ ok: true });
    expect(result.effectOutput).toBeUndefined();
  });

  test("uses explicit timeout override when provided", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 50;
    const result = await runTool(
      session,
      "shell-run",
      "call_1",
      { command: "npm test" },
      () => new Promise((resolve) => setTimeout(() => resolve("done"), 100)),
      { timeoutMs: 300 },
    );
    expect(result).toEqual({ result: "done" });
  });

  test("records exit code metadata from command-shaped results", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    await runTool(session, "test-run", "call_1", {}, async () => ({ kind: "test-run", exitCode: 1 }));
    expect(session.callLog[0]).toMatchObject({ toolName: "test-run", status: "succeeded", exitCode: 1 });
  });

  test("runs success pipeline stages in order", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    const events: string[] = [];
    session.onBeforeTool = () => {
      events.push("before-sync");
      return { append: "before output" };
    };
    session.onBeforeToolAsync = async () => {
      events.push("before-async");
    };
    session.onAfterTool = () => {
      events.push("after-sync");
      return { append: "after output" };
    };
    session.onAfterToolAsync = async () => {
      events.push(`after-async:call-log-${session.callLog.length}`);
    };

    const result = await runTool(session, "file-edit", "call_1", { path: "src/app.ts" }, async () => {
      events.push("execute");
      return { ok: true };
    });

    expect(result).toEqual({ result: { ok: true }, effectOutput: "before output\nafter output" });
    expect(events).toEqual(["before-sync", "before-async", "execute", "after-sync", "after-async:call-log-0"]);
    expect(session.callLog).toHaveLength(1);
  });

  test("uses cached result without executing and records the call", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    session.cache = createToolCache(new Set(["file-read"]));
    session.cache.set("file-read", { path: "src/app.ts" }, { result: { output: "cached" } });
    const events: string[] = [];
    session.onBeforeTool = () => {
      events.push("before-sync");
      return { append: "before output" };
    };
    session.onAfterTool = () => {
      events.push("after-sync");
      return { append: "after output" };
    };
    session.onAfterToolAsync = async () => {
      events.push("after-async");
    };

    const result = await runTool(session, "file-read", "call_1", { path: "src/app.ts" }, async () => {
      events.push("execute");
      return { output: "fresh" };
    });

    expect(result).toEqual({ result: { output: "cached" } });
    expect(events).toEqual(["before-sync", "after-async"]);
    expect(session.callLog[0]).toMatchObject({ toolName: "file-read", status: "succeeded" });
  });

  test("reports failed executions to async hooks before recording the failed call", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 500;
    const events: string[] = [];
    session.onAfterToolAsync = async (ctx) => {
      events.push(`${ctx.status}:call-log-${session.callLog.length}`);
    };

    await expect(
      runTool(session, "file-read", "call_1", {}, async () => {
        throw Object.assign(new Error("missing"), { code: "E_MISSING" });
      }),
    ).rejects.toThrow("file-read failed: missing");

    expect(events).toEqual(["failed:call-log-0"]);
    expect(session.callLog[0]).toMatchObject({ toolName: "file-read", status: "failed" });
  });
});
