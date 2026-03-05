import { describe, expect, test } from "bun:test";
import {
  defaultUserResourceId,
  parseResourceId,
  projectResourceIdFromWorkspace,
  resourceIdSchema,
} from "./resource-id";

describe("resource id", () => {
  test("accepts user_* and proj_* ids", () => {
    expect(resourceIdSchema.parse("user_abc123")).toBe("user_abc123");
    expect(resourceIdSchema.parse("proj_abc123")).toBe("proj_abc123");
  });

  test("parseResourceId returns undefined for unsupported prefixes", () => {
    expect(parseResourceId("sess_abc123")).toBeUndefined();
    expect(parseResourceId("run_abc123")).toBeUndefined();
  });

  test("projectResourceIdFromWorkspace is deterministic", () => {
    const a = projectResourceIdFromWorkspace("/tmp/acolyte-project");
    const b = projectResourceIdFromWorkspace("/tmp/acolyte-project");
    expect(a).toBe(b);
    expect(a.startsWith("proj_")).toBe(true);
  });

  test("defaultUserResourceId is deterministic for homeDir", () => {
    const a = defaultUserResourceId("/home/test-user");
    const b = defaultUserResourceId("/home/test-user");
    expect(a).toBe(b);
    expect(a.startsWith("user_")).toBe(true);
  });
});
