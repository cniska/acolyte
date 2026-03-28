import { describe, expect, test } from "bun:test";
import { agentModes, toolIdsForMode } from "./agent-modes";

describe("agentModes", () => {
  test("every mode has preamble", () => {
    for (const def of Object.values(agentModes)) {
      expect(def.preamble.length).toBeGreaterThan(0);
    }
  });

  test("verify mode stays read-only", () => {
    expect(agentModes.verify.grants).toEqual(["read", "test"]);
    expect(toolIdsForMode("verify")).toContain("code-scan");
    expect(toolIdsForMode("verify")).toContain("file-read");
    expect(toolIdsForMode("verify")).toContain("test-run");
    expect(toolIdsForMode("verify")).not.toContain("shell-run");
    expect(toolIdsForMode("verify")).not.toContain("file-edit");
    expect(toolIdsForMode("verify")).not.toContain("code-edit");
  });
});
