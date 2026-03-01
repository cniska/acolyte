import { describe, expect, test } from "bun:test";
import { agentModes, classifyMode, modeForTool } from "./agent-modes";

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

describe("classifyMode", () => {
  test("classifies edit/rename/refactor as code", () => {
    expect(classifyMode("rename the variable def to definition")).toBe("work");
    expect(classifyMode("edit the file src/agent.ts")).toBe("work");
    expect(classifyMode("refactor the function")).toBe("work");
    expect(classifyMode("fix the failing test")).toBe("work");
    expect(classifyMode("create a new util function")).toBe("work");
    expect(classifyMode("delete the unused import")).toBe("work");
    expect(classifyMode("run verify")).toBe("work");
    expect(classifyMode("improve the error handling")).toBe("work");
    expect(classifyMode("convert the config to YAML")).toBe("work");
    expect(classifyMode("migrate to the new API")).toBe("work");
  });

  test("classifies find/search/read as plan", () => {
    expect(classifyMode("find all test files in src")).toBe("plan");
    expect(classifyMode("search for usages of createClient")).toBe("plan");
    expect(classifyMode("what does modeForTool do?")).toBe("plan");
    expect(classifyMode("show me the agent.ts file")).toBe("plan");
    expect(classifyMode("how does the streaming work?")).toBe("plan");
    expect(classifyMode("list all exports from client.ts")).toBe("plan");
    expect(classifyMode("scan for unused imports")).toBe("plan");
  });

  test("prefers code when both signals present", () => {
    expect(classifyMode("find and rename all usages of Backend")).toBe("work");
    expect(classifyMode("read the file then edit it")).toBe("work");
  });

  test("falls back to plan for ambiguous messages", () => {
    expect(classifyMode("hi")).toBe("plan");
    expect(classifyMode("thanks")).toBe("plan");
  });

  test("never classifies user messages as verify", () => {
    expect(classifyMode("verify the code")).toBe("work");
    expect(classifyMode("run verify")).toBe("work");
  });
});
