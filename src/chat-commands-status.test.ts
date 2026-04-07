import { describe, expect, test } from "bun:test";
import { statusRows } from "./chat-commands-status";
import { isCommandOutput } from "./chat-contract";

describe("chat-commands-status", () => {
  test("statusRows returns commandOutput with labeled fields", () => {
    const [row] = statusRows({
      providers: ["openai"],
      model: "gpt-5-mini",
    });
    const content = row?.content;
    expect(isCommandOutput(content) && content.header).toBe("Status");
    const pairs = isCommandOutput(content) ? (content.sections[0] ?? []) : [];
    expect(pairs).toContainEqual(["Providers", "openai"]);
    expect(pairs).toContainEqual(["Model", "gpt-5-mini"]);
  });

  test("statusRows returns empty array when payload has no visible fields", () => {
    expect(statusRows({})).toHaveLength(0);
  });
});
