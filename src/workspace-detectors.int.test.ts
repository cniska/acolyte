import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { clearWorkspaceProfileCache, resolveWorkspaceProfile } from "./workspace-profile";

afterEach(clearWorkspaceProfileCache);

describe("workspace self-detection", () => {
  test("detects acolyte workspace profile", () => {
    const ws = join(__dirname, "..");
    const profile = resolveWorkspaceProfile(ws);
    expect(profile.ecosystem).toBe("typescript");
    expect(profile.packageManager).toBe("bun");
    expect(profile.lintCommand).toEqual({ bin: "bunx", args: ["biome", "check", "$FILES"] });
    expect(profile.formatCommand).toEqual({ bin: "bunx", args: ["biome", "check", "--write", "$FILES"] });
    expect(profile.testCommand).toEqual({ bin: "bun", args: ["test", "$FILES"] });
  });
});
