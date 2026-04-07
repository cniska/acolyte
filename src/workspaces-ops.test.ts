import { describe, expect, test } from "bun:test";
import { suggestWorkspaceName, workspaceNameSchema } from "./workspaces-ops";

describe("workspaces-ops", () => {
  test("suggestWorkspaceName slugifies prompt", () => {
    expect(suggestWorkspaceName("Fix auth flow")).toBe("fix-auth-flow");
    expect(suggestWorkspaceName("  Fix: auth   flow  ")).toBe("fix-auth-flow");
  });

  test("suggestWorkspaceName truncates to 40 chars and stays valid", () => {
    const name = suggestWorkspaceName("a".repeat(200));
    expect(name.length).toBe(40);
    expect(workspaceNameSchema.safeParse(name).success).toBe(true);
  });

  test("suggestWorkspaceName falls back to ws-<id> for empty slug", () => {
    const name = suggestWorkspaceName("!!!");
    expect(name.startsWith("ws-")).toBe(true);
    expect(workspaceNameSchema.safeParse(name).success).toBe(true);
  });
});

