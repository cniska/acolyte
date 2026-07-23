import { describe, expect, test } from "bun:test";
import { statusTokenTotals } from "./chat-status-line";

function entry(inputTokens: number, outputTokens: number) {
  return { usage: { inputTokens, outputTokens } };
}

describe("statusTokenTotals", () => {
  test("sums committed per-turn usage", () => {
    expect(statusTokenTotals([entry(100, 20), entry(50, 10)], null)).toEqual({ inputTokens: 150, outputTokens: 30 });
  });

  test("adds in-flight running usage to the committed total", () => {
    expect(statusTokenTotals([entry(100, 20)], { inputTokens: 40, outputTokens: 5 })).toEqual({
      inputTokens: 140,
      outputTokens: 25,
    });
  });

  test("is zero with no committed entries and no running usage", () => {
    expect(statusTokenTotals([], null)).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
