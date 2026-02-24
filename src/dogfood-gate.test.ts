import { describe, expect, test } from "bun:test";
import {
  consecutiveReadyRuns,
  firstNonEmptyLine,
  firstSignalLine,
  parseArgs,
  parseDeliveryProgress,
  progressDetail,
  smokeCommand,
  summarizeGate,
} from "./dogfood-gate";

describe("dogfood gate", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      target: 10,
      lookback: 30,
      minSuccessRate: 70,
      minDelegatedSlices: 6,
      minStableRuns: 1,
      strictAutonomy: false,
      skipVerify: false,
      skipSmoke: false,
      skipRecovery: false,
      skipOneShotDiagnostics: false,
      skipSessionDiagnostics: false,
      skipConcurrencySafety: false,
    });
  });

  test("parseArgs parses flags", () => {
    expect(
      parseArgs([
        "--target",
        "6",
        "--lookback",
        "14",
        "--min-success-rate",
        "85",
        "--min-delegated-slices",
        "8",
        "--min-stable-runs",
        "2",
        "--skip-verify",
        "--skip-smoke",
        "--skip-recovery",
        "--skip-one-shot-diagnostics",
        "--skip-session-diagnostics",
        "--skip-concurrency-safety",
      ]),
    ).toEqual({
      target: 6,
      lookback: 14,
      minSuccessRate: 85,
      minDelegatedSlices: 8,
      minStableRuns: 2,
      strictAutonomy: false,
      skipVerify: true,
      skipSmoke: true,
      skipRecovery: true,
      skipOneShotDiagnostics: true,
      skipSessionDiagnostics: true,
      skipConcurrencySafety: true,
    });
  });

  test("parseArgs accepts no-* aliases", () => {
    expect(
      parseArgs([
        "--target",
        "6",
        "--lookback",
        "14",
        "--no-verify",
        "--no-smoke",
        "--no-recovery",
        "--no-one-shot-diagnostics",
        "--no-session-diagnostics",
        "--no-concurrency-safety",
      ]),
    ).toEqual({
      target: 6,
      lookback: 14,
      minSuccessRate: 70,
      minDelegatedSlices: 6,
      minStableRuns: 1,
      strictAutonomy: false,
      skipVerify: true,
      skipSmoke: true,
      skipRecovery: true,
      skipOneShotDiagnostics: true,
      skipSessionDiagnostics: true,
      skipConcurrencySafety: true,
    });
  });

  test("parseArgs rejects invalid success-rate value", () => {
    expect(() => parseArgs(["--min-success-rate", "101"])).toThrow("Invalid --min-success-rate value.");
  });

  test("parseArgs rejects invalid delegated-slices value", () => {
    expect(() => parseArgs(["--min-delegated-slices", "-1"])).toThrow("Invalid --min-delegated-slices value.");
  });

  test("parseArgs rejects invalid stable-runs value", () => {
    expect(() => parseArgs(["--min-stable-runs", "0"])).toThrow("Invalid --min-stable-runs value.");
  });

  test("parseArgs enforces stricter autonomy thresholds when enabled", () => {
    expect(parseArgs(["--strict-autonomy"])).toEqual({
      target: 10,
      lookback: 30,
      minSuccessRate: 85,
      minDelegatedSlices: 10,
      minStableRuns: 3,
      strictAutonomy: true,
      skipVerify: false,
      skipSmoke: false,
      skipRecovery: false,
      skipOneShotDiagnostics: false,
      skipSessionDiagnostics: false,
      skipConcurrencySafety: false,
    });
    expect(
      parseArgs([
        "--strict-autonomy",
        "--min-success-rate",
        "90",
        "--min-delegated-slices",
        "12",
        "--min-stable-runs",
        "4",
      ]),
    ).toEqual({
      target: 10,
      lookback: 30,
      minSuccessRate: 90,
      minDelegatedSlices: 12,
      minStableRuns: 4,
      strictAutonomy: true,
      skipVerify: false,
      skipSmoke: false,
      skipRecovery: false,
      skipOneShotDiagnostics: false,
      skipSessionDiagnostics: false,
      skipConcurrencySafety: false,
    });
  });

  test("consecutiveReadyRuns counts matching-mode streak including current run", () => {
    const history = [
      { at: "2026-02-23T10:00:00.000Z", ready: true, strictAutonomy: false },
      { at: "2026-02-23T11:00:00.000Z", ready: true, strictAutonomy: true },
      { at: "2026-02-23T12:00:00.000Z", ready: true, strictAutonomy: true },
      { at: "2026-02-23T13:00:00.000Z", ready: false, strictAutonomy: true },
      { at: "2026-02-23T14:00:00.000Z", ready: true, strictAutonomy: true },
    ];
    expect(consecutiveReadyRuns(history, true, true)).toBe(2);
    expect(consecutiveReadyRuns(history, true, false)).toBe(0);
    expect(consecutiveReadyRuns(history, false, true)).toBe(2);
  });

  test("parseDeliveryProgress reads progress json", () => {
    expect(parseDeliveryProgress('{"deliverySlices":16,"target":10,"percent":100}')).toEqual({
      delivery: 16,
      target: 10,
      percent: 100,
      delegatedSuccess: undefined,
      delegatedFailure: undefined,
      delegatedSuccessRate: undefined,
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
      delegatedSuccess: undefined,
      delegatedFailure: undefined,
      delegatedSuccessRate: undefined,
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
        stdout:
          '{"deliverySlices":7,"target":6,"percent":100,"delegatedSuccess":7,"delegatedFailure":2,"delegatedSuccessRate":78,"commitsTotal":10,"commitsScanned":13}',
        stderr: "",
      },
      {
        delivery: 7,
        target: 6,
        percent: 100,
        delegatedSuccess: 7,
        delegatedFailure: 2,
        delegatedSuccessRate: 78,
        commitsTotal: 10,
        commitsScanned: 13,
      },
    );
    expect(detail).toBe("7/6 (100%, remaining=0 success=7 failure=2 rate=78% scoped=10 scanned=13)");
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

  test("smokeCommand requires provider-ready only in strict autonomy mode", () => {
    expect(smokeCommand(false)).toEqual(["bun", "run", "dogfood:smoke"]);
    expect(smokeCommand(true)).toEqual(["bun", "run", "dogfood:smoke", "--", "--require-provider-ready"]);
  });
});
