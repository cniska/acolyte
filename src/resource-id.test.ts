import { describe, expect, test } from "bun:test";
import {
  defaultUserResourceId,
  parseResourceId,
  projectResourceIdForLabel,
  projectResourceIdFromWorkspace,
  resourceIdSchema,
} from "./resource-id";

// The dashboard names a scope by storing the label beside the key, so the key must stay the hash of it.
function sha1Prefix(value: string): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(value);
  return hasher.digest("hex").slice(0, 12);
}

describe("resource id", () => {
  test("accepts user_* and proj_* ids", () => {
    expect(resourceIdSchema.parse("user_abc123")).toBe("user_abc123");
    expect(resourceIdSchema.parse("proj_abc123")).toBe("proj_abc123");
  });

  test("a project id is the hash of the repository it names", () => {
    expect(projectResourceIdForLabel("cniska/acolyte")).toBe(`proj_${sha1Prefix("cniska/acolyte")}`);
    expect(projectResourceIdForLabel("owner/repo")).not.toBe(projectResourceIdForLabel("owner/other"));
  });

  test("parseResourceId returns undefined for unsupported prefixes", () => {
    expect(parseResourceId("sess_abc123")).toBeUndefined();
    expect(parseResourceId("run_abc123")).toBeUndefined();
  });

  test("a workspace outside a repository has no project id", () => {
    expect(projectResourceIdFromWorkspace("/tmp/acolyte-project")).toBeNull();
  });

  test("defaultUserResourceId is deterministic for homeDir", () => {
    const a = defaultUserResourceId({ HOME: "/home/test-user" });
    const b = defaultUserResourceId({ HOME: "/home/test-user" });
    expect(a).toBe(b);
    expect(a.startsWith("user_")).toBe(true);
  });
});
