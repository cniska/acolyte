import { describe, expect, test } from "bun:test";
import { invariant } from "./assert";
import { withToolError } from "./tool-execution";

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
