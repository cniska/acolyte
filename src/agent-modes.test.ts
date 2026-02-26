import { describe, expect, test } from "bun:test";
import { agentModes, modeForTool } from "./agent-modes";

describe("modeForTool", () => {
  test("maps read-only tools to explore", () => {
    expect(modeForTool("read-file")).toBe("explore");
    expect(modeForTool("find-files")).toBe("explore");
    expect(modeForTool("search-files")).toBe("explore");
    expect(modeForTool("git-status")).toBe("explore");
    expect(modeForTool("git-diff")).toBe("explore");
    expect(modeForTool("web-search")).toBe("explore");
    expect(modeForTool("web-fetch")).toBe("explore");
  });

  test("maps write tools to code", () => {
    expect(modeForTool("edit-file")).toBe("code");
    expect(modeForTool("create-file")).toBe("code");
    expect(modeForTool("edit-code")).toBe("code");
    expect(modeForTool("delete-file")).toBe("code");
    expect(modeForTool("run-command")).toBe("code");
  });

  test("falls back to ask for unknown tools", () => {
    expect(modeForTool("unknown-tool")).toBe("ask");
  });
});

describe("agentModes", () => {
  test("every mode has non-empty progressText", () => {
    for (const def of Object.values(agentModes)) {
      expect(def.progressText.length).toBeGreaterThan(0);
    }
  });
});
