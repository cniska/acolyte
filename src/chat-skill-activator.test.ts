import { describe, expect, test } from "bun:test";
import { isToolOutput } from "./chat-contract";
import { skillActivationRow } from "./chat-skill-activator";

describe("skillActivationRow", () => {
  test("creates a tool row with skill header", () => {
    const row = skillActivationRow("build");
    expect(row.kind).toBe("tool");
    expect(row.id).toMatch(/^row_/);
    expect(isToolOutput(row.content)).toBe(true);
    if (isToolOutput(row.content)) {
      expect(row.content.parts).toHaveLength(1);
      expect(row.content.parts[0]).toMatchObject({
        kind: "tool-header",
        detail: "build",
      });
    }
  });
});
