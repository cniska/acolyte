import { describe, expect, test } from "bun:test";
import {
  firstNonEmptyLine,
  firstSignalLine,
  parseArgs,
  parseDeliveryProgress,
  progressDetail,
  summarizeGate,
} from "./dogfood-gate";

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

  test("parseArgs accepts no-* aliases", () => {
    expect(parseArgs(["--target", "6", "--lookback", "14", "--no-verify", "--no-smoke"])).toEqual({
      target: 6,
      lookback: 14,
      skipVerify: true,
      skipSmoke: true,
    });
  });

  test("parseDeliveryProgress reads progress json", () => {
    expect(parseDeliveryProgress('{"deliverySlices":16,"target":10,"percent":100}')).toEqual({
      delivery: 16,
      target: 10,
      percent: 100,
      commitsTotal: undefined,
      commitsScanned: undefined,
    });
    expect(parseDeliveryProgress("- slices (delivery): 16/10 (100%)")).toBeNull();
  });

  test("parseDeliveryProgress tolerates surrounding log lines", () => {
    const noisy = [
      "Running dogfood progress...",
      '{"deliverySlices":6,"target":6,"percent":100,"commitsTotal":10,"commitsScanned":14}',
      "done",
    ].join("\n");
    expect(parseDeliveryProgress(noisy)).toEqual({
      delivery: 6,
      target: 6,
      percent: 100,
      commitsTotal: 10,
      commitsScanned: 14,
    });
  });

  test("firstNonEmptyLine returns first meaningful line", () => {
    expect(firstNonEmptyLine("\n \nerror one\nerror two")).toBe("error one");
    expect(firstNonEmptyLine("\n \n")).toBeNull();
  });

  test("firstSignalLine skips shell noise and script wrapper errors", () => {
    const stderr = ["$ bun run dogfood:smoke", 'error: script "dogfood:smoke" exited with code 1'].join("\n");
    const stdout = ["Running dogfood smoke checks...", "✗ status: command failed (exit 1)"].join("\n");
    expect(firstSignalLine(stderr, stdout)).toBe("Running dogfood smoke checks...");
  });

  test("progressDetail reports parsed values when available", () => {
    const detail = progressDetail(
      {
        ok: true,
        stdout: '{"deliverySlices":7,"target":6,"percent":100,"commitsTotal":10,"commitsScanned":13}',
        stderr: "",
      },
      { delivery: 7, target: 6, percent: 100, commitsTotal: 10, commitsScanned: 13 },
    );
    expect(detail).toBe("7/6 (100%, remaining=0 scoped=10 scanned=13)");
  });

  test("progressDetail includes signal line on parse failure", () => {
    const detail = progressDetail(
      {
        ok: false,
        stdout: '$ bun run dogfood:progress\nerror: script "dogfood:progress" exited with code 1',
        stderr: "boom",
      },
      null,
    );
    expect(detail).toBe("unable to parse progress (boom)");
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
