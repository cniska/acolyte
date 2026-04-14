import { describe, expect, test } from "bun:test";
import { usageRows } from "./chat-commands-usage";
import { isCommandOutput } from "./chat-contract";
import type { SessionTokenUsageEntry } from "./session-contract";

describe("chat-commands-usage", () => {
  test("usageRows includes expected metric keys", () => {
    const usage: SessionTokenUsageEntry = {
      id: "row_1",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        inputBudgetTokens: 300,
        inputTruncated: false,
      },
      promptBreakdown: {
        budgetTokens: 300,
        usedTokens: 100,
        systemTokens: 40,
        toolTokens: 30,
        skillTokens: 20,
        memoryTokens: 0,
        messageTokens: 10,
      },
    };
    const [row] = usageRows(usage);
    const content = row?.content;
    const allPairs = isCommandOutput(content) ? content.sections.flat() : [];
    const keys = allPairs.map(([k]) => k);
    expect(keys).toContain("Input");
    expect(keys).toContain("Output");
    expect(keys).toContain("System");
    expect(keys).toContain("Tools");
    expect(keys).toContain("Skills");
    expect(keys).toContain("Messages");
  });

  test("usageRows does not include budget warning", () => {
    const usage: SessionTokenUsageEntry = {
      id: "row_warn",
      usage: {
        inputTokens: 900,
        outputTokens: 40,
        totalTokens: 940,
        inputBudgetTokens: 1000,
        inputTruncated: true,
      },
    };
    const [row] = usageRows(usage);
    const content = row?.content;
    const allPairs = isCommandOutput(content) ? content.sections.flat() : [];
    expect(allPairs.every(([k]) => !k.toLowerCase().includes("warning"))).toBe(true);
    expect(allPairs.every(([, v]) => !v.includes("context trimmed"))).toBe(true);
  });

  test("usageRows uses prompt breakdown total for percentages", () => {
    const usage: SessionTokenUsageEntry = {
      id: "row_1",
      usage: { inputTokens: 50, outputTokens: 2, totalTokens: 52 },
      promptBreakdown: {
        budgetTokens: 1000,
        usedTokens: 100,
        systemTokens: 20,
        toolTokens: 30,
        skillTokens: 10,
        memoryTokens: 0,
        messageTokens: 40,
      },
    };
    const [row] = usageRows(usage);
    const content = row?.content;
    const allPairs = isCommandOutput(content) ? content.sections.flat() : [];
    const find = (key: string) => allPairs.find(([k]) => k === key)?.[1] ?? "";
    expect(find("System")).toContain("20%");
    expect(find("Tools")).toContain("30%");
    expect(find("Skills")).toContain("10%");
    expect(find("Messages")).toContain("40%");
  });

  test("usageRows returns fallback row when no usage data", () => {
    const [row] = usageRows(null);
    expect(row?.content).toBe("No usage data yet. Send a prompt first.");
  });
});
