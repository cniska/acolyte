import { describe, expect, test } from "bun:test";
import { statusRows } from "./chat-commands-status";
import { isCommandOutput } from "./chat-contract";

describe("chat-commands-status", () => {
  test("statusRows returns commandOutput with labeled fields", () => {
    const [row] = statusRows({
      provider_auth: ["openai (api key)"],
      memory: "12 project, 3 user",
    });
    const content = row?.content;
    expect(isCommandOutput(content) && content.header).toBe("Status");
    const pairs = isCommandOutput(content) ? (content.sections[0] ?? []) : [];
    expect(pairs).toContainEqual(["Providers", "openai (api key)"]);
    expect(pairs).toContainEqual(["Memory", "12 project, 3 user"]);
  });

  test("the status carries no model, since the session's own model is the only one", () => {
    const [row] = statusRows({ provider_auth: ["openai (api key)"], model: "gpt-5-mini" });
    const content = row?.content;
    const pairs = isCommandOutput(content) ? (content.sections[0] ?? []) : [];

    expect(pairs.map(([label]) => label)).not.toContain("Model");
  });

  test("statusRows returns empty array when payload has no visible fields", () => {
    expect(statusRows({})).toHaveLength(0);
  });
});
