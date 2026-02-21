import { describe, expect, test } from "bun:test";
import { parseArgs, parseDeliveryProgress, summarizeGate } from "./dogfood-gate";

describe("dogfood gate", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      target: 10,
      lookback: 30,
      skipVerify: false,
      skipSmoke: false,
    });
  });

  test("parseArgs parses flags", () => {
    expect(parseArgs(["--target", "6", "--lookback", "14", "--skip-verify", "--skip-smoke"])).toEqual({
      target: 6,
      lookback: 14,
      skipVerify: true,
      skipSmoke: true,
    });
  });

  test("parseDeliveryProgress reads progress line", () => {
    expect(parseDeliveryProgress("- slices (delivery): 16/10 (100%)")).toEqual({
      delivery: 16,
      target: 10,
      percent: 100,
    });
  });

  test("summarizeGate reports ready when all checks pass", () => {
    const summary = summarizeGate([
      { name: "verify", ok: true, detail: "green" },
      { name: "smoke", ok: true, detail: "green" },
    ]);
    expect(summary.ok).toBe(true);
    expect(summary.lines.at(-1)).toBe("- result: ready");
  });

  test("summarizeGate reports not ready when any check fails", () => {
    const summary = summarizeGate([
      { name: "verify", ok: true, detail: "green" },
      { name: "smoke", ok: false, detail: "exit 1" },
    ]);
    expect(summary.ok).toBe(false);
    expect(summary.lines.at(-1)).toBe("- result: not ready");
  });
});
