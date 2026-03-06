import { afterEach, describe, expect, test } from "bun:test";
import { setPermissionMode } from "./app-config";
import { savedPermissionMode } from "./test-utils";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { toolsForAgent } from "./tool-registry";

const restorePermissions = savedPermissionMode();

afterEach(restorePermissions);

describe("tool error wrapper integration", () => {
  test("preserves guard-blocked code from guarded execution", async () => {
    setPermissionMode("write");
    const { tools } = toolsForAgent({ workspace: process.cwd() });
    await tools.runCommand.execute({ command: "echo verify" });
    try {
      await tools.runCommand.execute({ command: "echo verify" });
      throw new Error("expected duplicate verify guard to block");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error & { code?: string };
      expect(wrapped.code).toBe(LIFECYCLE_ERROR_CODES.guardBlocked);
      expect(wrapped.message).toContain("run-command failed:");
    }
  });
});
