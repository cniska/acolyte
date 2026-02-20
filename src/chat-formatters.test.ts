import { describe, expect, test } from "bun:test";
import { formatChangesSummary, formatDogfoodStatus, formatThoughtDuration, formatVerifySummary } from "./chat-formatters";

describe("chat-formatters helpers", () => {
  test("formatThoughtDuration renders ms and s forms", () => {
    expect(formatThoughtDuration(240)).toBe("240ms");
    expect(formatThoughtDuration(1200)).toBe("1.2s");
  });

  test("formatVerifySummary renders compact pass/fail line", () => {
    expect(formatVerifySummary("exit_code=0\nduration_ms=1530")).toBe("Verify passed (exit 0, 1.5s).");
    expect(formatVerifySummary("exit_code=1\nduration_ms=320")).toBe("Verify failed (exit 1, 320ms).");
  });

  test("formatDogfoodStatus renders compact readiness summary", () => {
    const out = formatDogfoodStatus({
      backendStatus: "mode=openai service=acolyte-backend",
      verifySummary: "Verify passed (exit 0, 1.2s).",
      hasApiKey: true,
    });
    expect(out).toContain("Dogfood status");
    expect(out).toContain("- Verify passed (exit 0, 1.2s).");
    expect(out).toContain("- Backend: mode=openai service=acolyte-backend");
    expect(out).toContain("- OPENAI_API_KEY: set");
  });

  test("formatChangesSummary renders git status and diff totals", () => {
    const status = ["## main...origin/main", " M src/cli.ts", "?? src/new.ts"].join("\n");
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "-old", "+new", "+another"].join("\n");
    const out = formatChangesSummary(status, diff);
    expect(out).toContain("2 changed files.");
    expect(out).toContain("## main...origin/main");
    expect(out).toContain("Diff summary: +2 -1.");
  });

  test("formatChangesSummary handles singular changed-file count", () => {
    const status = ["## main...origin/main", " M src/cli.ts"].join("\n");
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "-old", "+new"].join("\n");
    const out = formatChangesSummary(status, diff);
    expect(out).toContain("1 changed file.");
  });
});
