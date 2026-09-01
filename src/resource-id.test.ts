import { describe, expect, test } from "bun:test";
import {
  LOCAL_USER_RESOURCE_ID,
  parseResourceId,
  projectResourceIdForLabel,
  projectResourceIdFromWorkspace,
  resourceIdSchema,
  userResourceIdForSubject,
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

  test("a user id is the hash of the account it names", () => {
    const subject = "012627e3-1df9-476a-919d-f208a6bb9830";
    expect(userResourceIdForSubject(subject)).toBe(`user_${sha1Prefix(subject)}`);
    expect(userResourceIdForSubject("one")).not.toBe(userResourceIdForSubject("two"));
  });

  test("the installation's own user scope is a constant", () => {
    expect(LOCAL_USER_RESOURCE_ID).toBe("user_local");
  });
});
