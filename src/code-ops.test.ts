import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { editCode } from "./code-ops";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";

const WORKSPACE = resolve(process.cwd());

describe("editCode", () => {
  test("blocks paths outside workspace", async () => {
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: "/etc/hosts",
        edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });
});
