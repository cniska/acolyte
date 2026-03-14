import { describe, expect, test } from "bun:test";
import { invariant } from "./assert";
import { LIFECYCLE_ERROR_CODES } from "./error-primitives";
import { guardedExecute, withToolError } from "./tool-execution";
import { createSessionContext } from "./tool-guards";

describe("withToolError", () => {
  test("prefixes thrown errors with tool id", async () => {
    await expect(withToolError("read-file", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "read-file failed: boom",
    );
  });

  test("preserves structured error code on wrapped errors", async () => {
    const source = Object.assign(new Error("multi-match"), { code: "E_EDIT_FILE_MULTI_MATCH" });
    try {
      await withToolError("edit-file", async () => Promise.reject(source));
      invariant(false, "expected withToolError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error & { code?: string };
      expect(wrapped.message).toBe("edit-file failed: multi-match");
      expect(wrapped.code).toBe("E_EDIT_FILE_MULTI_MATCH");
    }
  });
});

describe("per-tool timeout", () => {
  test("rejects with timeout error when tool exceeds limit", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 50;
    try {
      await guardedExecute("slow-tool", {}, session, () => new Promise((resolve) => setTimeout(resolve, 500)));
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
    const result = await guardedExecute("fast-tool", {}, session, async () => "done");
    expect(result).toBe("done");
  });

  test("uses explicit timeout override when provided", async () => {
    const session = createSessionContext();
    session.toolTimeoutMs = 50;
    const result = await guardedExecute(
      "run-command",
      { command: "npm test", timeoutMs: 300 },
      session,
      () => new Promise((resolve) => setTimeout(() => resolve("done"), 100)),
      { timeoutMs: 300 },
    );
    expect(result).toBe("done");
  });
});
