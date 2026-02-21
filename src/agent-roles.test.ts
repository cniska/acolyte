import { describe, expect, test } from "bun:test";
import { buildRoleInstructions, buildSubagentContext } from "./agent-roles";
import type { ChatRequest } from "./api";

describe("agent role guidance", () => {
  test("coder context prefers a single recommendation over option menus", () => {
    const req: ChatRequest = {
      model: "openai/gpt-5-mini",
      message: "what should I do next?",
      history: [],
    };

    const context = buildSubagentContext("coder", req);
    expect(context).toContain("prefer one clear recommendation over option menus");
  });

  test("default coder role instructions discourage lettered menus", () => {
    const merged = buildRoleInstructions("Base soul", "coder");
    expect(merged).toContain("avoid lettered choice menus unless explicitly requested");
  });
});
