import { describe, expect, test } from "bun:test";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { toolsForAgent } from "./tool-registry";

describe("tool error wrapper integration", () => {
  test("preserves guard-blocked code from guarded execution", async () => {
    const { tools } = toolsForAgent({ workspace: process.cwd() });
    await tools.runCommand.execute({ cmd: "echo", args: ["verify"] }, "test-call-1");
    try {
      await tools.runCommand.execute({ cmd: "echo", args: ["verify"] }, "test-call-2");
      throw new Error("expected duplicate verify guard to block");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error & { code?: string };
      expect(wrapped.code).toBe(LIFECYCLE_ERROR_CODES.guardBlocked);
      expect(wrapped.message).toContain("shell-run failed:");
    }
  });
});
