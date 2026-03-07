import { describe, expect, test } from "bun:test";
import { agentModes, modeForTool } from "./agent-modes";

describe("modeForTool", () => {
  test("maps read-only tools to plan", () => {
    expect(modeForTool("read-file")).toBe("plan");
    expect(modeForTool("find-files")).toBe("plan");
    expect(modeForTool("search-files")).toBe("plan");
    expect(modeForTool("git-status")).toBe("plan");
    expect(modeForTool("git-diff")).toBe("plan");
    expect(modeForTool("git-log")).toBe("plan");
    expect(modeForTool("git-show")).toBe("plan");
    expect(modeForTool("web-search")).toBe("plan");
    expect(modeForTool("web-fetch")).toBe("plan");
    expect(modeForTool("scan-code")).toBe("plan");
  });

  test("maps write tools to code", () => {
    expect(modeForTool("edit-file")).toBe("work");
    expect(modeForTool("create-file")).toBe("work");
    expect(modeForTool("edit-code")).toBe("work");
    expect(modeForTool("delete-file")).toBe("work");
    expect(modeForTool("run-command")).toBe("work");
  });

  test("never maps tools to verify (verify is auto-triggered, not tool-inferred)", () => {
    for (const tool of agentModes.verify.tools) {
      expect(modeForTool(tool)).not.toBe("verify");
    }
  });

  test("falls back to code for unknown tools", () => {
    expect(modeForTool("unknown-tool")).toBe("work");
  });
});

describe("agentModes", () => {
  test("every mode has non-empty statusText", () => {
    for (const def of Object.values(agentModes)) {
      expect(def.statusText.length).toBeGreaterThan(0);
    }
  });

  test("every mode has preamble", () => {
    for (const def of Object.values(agentModes)) {
      expect(def.preamble.length).toBeGreaterThan(0);
    }
  });
});
