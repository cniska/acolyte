import { describe, expect, test } from "bun:test";
import {
  formatDogfoodStatusOutput,
  formatEditUpdateOutput,
  formatForTool,
  formatRunOutput,
  formatStatusOutput,
  formatTimestamp,
  resolveCommandAlias,
  suggestCommand,
  suggestCommands,
  summarizeDiff,
  truncateText,
} from "./cli";

describe("cli formatting helpers", () => {
  test("formatRunOutput compresses long stdout", () => {
    const payload = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`);
    const raw = ["exit_code=0", "duration_ms=42", "stdout:", ...payload].join("\n");
    const out = formatRunOutput(raw);
    expect(out).toContain("exit_code=0");
    expect(out).toContain("duration_ms=42");
    expect(out).toContain("stdout:");
    expect(out).toContain("line-1");
    expect(out).toContain("… +6 lines");
    expect(out).toContain("line-15");
  });

  test("formatStatusOutput expands key-value status", () => {
    const out = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767",
    );
    expect(out).toBe(
      ["provider: openai", "model:    gpt-5-mini", "service:  acolyte-backend", "url:      http://localhost:6767"].join(
        "\n",
      ),
    );
  });

  test("formatStatusOutput groups memory and OM fields", () => {
    const out = formatStatusOutput(
      [
        "mode=openai",
        "provider=openai",
        "model=gpt-5-mini",
        "model_main=openai/gpt-5-mini",
        "model_planner=openai/o3",
        "model_coder=openai/gpt-5-codex",
        "model_reviewer=openai/gpt-5-mini",
        "service=acolyte-backend",
        "url=http://localhost:6767",
        "memory_storage=postgres",
        "om=enabled",
        "om_scope=resource",
        "om_model=openai/gpt-5-mini",
        "om_obs_tokens=3000",
        "om_ref_tokens=8000",
        "om_exists=true",
        "om_gen=4",
      ].join(" "),
    );
    expect(out).toMatch(/provider:\s+openai/);
    expect(out).toMatch(/mode:\s+openai/);
    expect(out).toMatch(/model:\s+gpt-5-mini/);
    expect(out).toMatch(
      /models:\s+main=openai\/gpt-5-mini planner=openai\/o3 coder=openai\/gpt-5-codex reviewer=openai\/gpt-5-mini/,
    );
    expect(out).toMatch(/memory:\s+postgres/);
    expect(out).toMatch(/om:\s+enabled scope=resource model=openai\/gpt-5-mini/);
    expect(out).toMatch(/om_tokens:\s+obs=3000 ref=8000/);
    expect(out).toMatch(/om_state:\s+exists=true gen=4/);
  });

  test("formatDogfoodStatusOutput renders concise readiness lines", () => {
    const out = formatDogfoodStatusOutput({
      backendStatus: "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767",
      verifyRaw: "exit_code=0\nduration_ms=200\nstdout:\nok",
      hasApiKey: true,
    });
    expect(out).toContain("Dogfood status");
    expect(out).toContain("- Verify: exit_code=0");
    expect(out).toMatch(/- Backend: .*provider:\s+openai/);
    expect(out).toMatch(/- Backend: .*model:\s+gpt-5-mini/);
    expect(out).toMatch(/- Backend: .*service:\s+acolyte-backend/);
    expect(out).toMatch(/- Backend: .*url:\s+http:\/\/localhost:6767/);
    expect(out).toContain("- OPENAI_API_KEY: set");
  });

  test("formatSearchOutput includes match and file counts", () => {
    const raw = ["./a.ts:1:foo", "./a.ts:2:bar", "./b.ts:9:baz"].join("\n");
    const out = formatForTool("search", raw);
    expect(out).toContain("3 matches in 2 files");
  });

  test("formatSearchOutput handles no-match responses", () => {
    expect(formatForTool("search", "No matches.")).toBe("No matches.");
    expect(formatForTool("search", "")).toBe("No matches.");
  });

  test("formatReadOutput includes line count", () => {
    const raw = ["one", "two", "three"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toContain("3 lines");
  });

  test("formatReadOutput normalizes repo-local File path", () => {
    const raw = [`File: ${process.cwd()}/src/cli.ts`, "1: a", "2: b"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toContain("2 lines");
    expect(out).toContain("File: src/cli.ts");
  });

  test("formatDiffOutput includes file and line summary", () => {
    const raw = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatForTool("diff", raw);
    expect(out).toContain("1 file changed, +1 -1");
  });

  test("formatGitStatusOutput includes changed-file summary", () => {
    const raw = ["## main...origin/main", " M src/cli.ts", "?? src/new.ts"].join("\n");
    const out = formatForTool("status", raw);
    expect(out).toContain("2 changed files");
    expect(out).toContain("## main...origin/main");
  });

  test("summarizeDiff counts added and removed lines", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 123..456 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      "-old",
      "+new",
      "+extra",
      " context",
    ].join("\n");
    const result = summarizeDiff(diff);
    expect(result.added).toBe(2);
    expect(result.removed).toBe(1);
    expect(result.locations).toBe(1);
    expect(result.preview[0]).toContain("@@ -1,2 +1,3 @@");
    expect(result.preview.some((line) => line.includes("-old"))).toBe(true);
    expect(result.preview.some((line) => line.includes("+new"))).toBe(true);
  });

  test("formatEditUpdateOutput includes replacement and line summary", () => {
    const diff = ["@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatEditUpdateOutput(1, diff);
    expect(out).toContain("1 replacement applied.");
    expect(out).toContain("1 location updated.");
    expect(out).toContain("Added 1 line, removed 1 line.");
    expect(out).toContain("Preview:");
    expect(out).toContain("@@ -1 +1 @@");
  });

  test("formatEditUpdateOutput explains when diff preview is unavailable", () => {
    const out = formatEditUpdateOutput(1, "");
    expect(out).toContain("1 replacement applied.");
    expect(out).toContain("No diff preview available");
  });

  test("formatRunOutput hides shell echo noise in successful stderr", () => {
    const raw = ["exit_code=0", "duration_ms=12", "stdout:", "ok", "stderr:", "$ bun run typecheck"].join("\n");
    const out = formatRunOutput(raw);
    expect(out).toContain("stdout:");
    expect(out).toContain("ok");
    expect(out).not.toContain("stderr:");
  });

  test("truncateText and formatTimestamp stay stable", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(formatTimestamp("2026-02-20T15:06:12.000Z")).toMatch(/^2026-02-20 \d{2}:\d{2}$/);
  });

  test("resolveCommandAlias maps short commands", () => {
    expect(resolveCommandAlias("?")).toBe("?");
    expect(resolveCommandAlias("/exit")).toBe("/exit");
    expect(resolveCommandAlias("/run")).toBe("/run");
  });

  test("suggestCommand supports canonical and alias prefixes", () => {
    expect(suggestCommand("/e")).toBe("/exit");
    expect(suggestCommand("/exi")).toBe("/exit");
    expect(suggestCommand("/ext")).toBe("/exit");
    expect(suggestCommand("?")).toBe("?");
    expect(suggestCommand("plain text")).toBeNull();
  });

  test("suggestCommands returns multiple ranked suggestions", () => {
    expect(suggestCommands("/", 3)).toEqual(["/exit"]);
    expect(suggestCommands("/exot", 3)).toContain("/exit");
    expect(suggestCommands("no slash", 3)).toEqual([]);
  });
});
