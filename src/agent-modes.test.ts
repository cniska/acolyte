import { describe, expect, test } from "bun:test";
import { agentModes, classifyMode, modeForTool } from "./agent-modes";

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

  test("every mode has preamble", () => {
    for (const def of Object.values(agentModes)) {
      expect(def.preamble.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyMode", () => {
  test("classifies edit/rename/refactor as code", () => {
    expect(classifyMode("rename the variable def to definition")).toBe("code");
    expect(classifyMode("edit the file src/agent.ts")).toBe("code");
    expect(classifyMode("refactor the function")).toBe("code");
    expect(classifyMode("fix the failing test")).toBe("code");
    expect(classifyMode("create a new util function")).toBe("code");
    expect(classifyMode("delete the unused import")).toBe("code");
    expect(classifyMode("run verify")).toBe("code");
  });

  test("classifies find/search/read as explore", () => {
    expect(classifyMode("find all test files in src")).toBe("explore");
    expect(classifyMode("search for usages of createClient")).toBe("explore");
    expect(classifyMode("what does modeForTool do?")).toBe("explore");
    expect(classifyMode("show me the agent.ts file")).toBe("explore");
    expect(classifyMode("how does the streaming work?")).toBe("explore");
    expect(classifyMode("list all exports from client.ts")).toBe("explore");
  });

  test("prefers code when both signals present", () => {
    expect(classifyMode("find and rename all usages of Backend")).toBe("code");
    expect(classifyMode("read the file then edit it")).toBe("code");
  });

  test("falls back to code for ambiguous messages", () => {
    expect(classifyMode("hi")).toBe("code");
    expect(classifyMode("thanks")).toBe("code");
  });
});
