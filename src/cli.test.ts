import { describe, expect, test } from "bun:test";
import {
  buildUsageCommandRows,
  displayPromptForOutput,
  extractVersionFromPackageJsonText,
  formatAssistantReplyOutput,
  formatEditUpdateOutput,
  formatForTool,
  formatKeyValueLines,
  formatPromptError,
  formatResumeCommand,
  formatRunOutput,
  formatStatusOutput,
  formatTimestamp,
  isTopLevelHelpCommand,
  isTopLevelVersionCommand,
  oneShotResourceId,
  parseDogfoodArgs,
  parseEditResult,
  parseRunExitCode,
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

  test("parseRunExitCode reads exit code from run output", () => {
    expect(parseRunExitCode("exit_code=0\nduration_ms=20")).toBe(0);
    expect(parseRunExitCode("exit_code=17\nstdout:\nnope")).toBe(17);
    expect(parseRunExitCode("stdout:\nmissing")).toBeNull();
  });

  test("parseDogfoodArgs enables verify by default", () => {
    expect(parseDogfoodArgs(["ping"])).toEqual({ files: [], prompt: "ping", verify: true });
  });

  test("parseDogfoodArgs supports --no-verify and --file", () => {
    expect(parseDogfoodArgs(["--file", "src/cli.ts", "--no-verify", "ping"])).toEqual({
      files: ["src/cli.ts"],
      prompt: "ping",
      verify: false,
    });
  });

  test("parseEditResult parses strict edit metadata", () => {
    expect(parseEditResult("path=/tmp/a.ts\nmatches=2\ndry_run=true")).toEqual({
      path: "/tmp/a.ts",
      matches: 2,
      dryRun: true,
    });
    expect(parseEditResult("path=/tmp/a.ts\nmatches=2\ndry_run=false")).toEqual({
      path: "/tmp/a.ts",
      matches: 2,
      dryRun: false,
    });
    expect(parseEditResult("path=/tmp/a.ts\nmatches=2\ndry_run=maybe")).toBeNull();
  });

  test("formatStatusOutput expands key-value status", () => {
    const out = formatStatusOutput(
      "provider=openai model=gpt-5-mini service=acolyte-backend url=http://localhost:6767",
    );
    expect(out).toBe(
      [
        "provider: openai",
        "model:    gpt-5-mini",
        "service:  acolyte-backend",
        "          url: http://localhost:6767",
      ].join("\n"),
    );
  });

  test("formatStatusOutput groups memory and OM fields", () => {
    const out = formatStatusOutput(
      [
        "mode=openai",
        "provider=openai",
        "model=gpt-5-mini",
        "provider_ready=false",
        "service=acolyte-backend",
        "url=http://localhost:6767",
        "memory_storage=postgres",
        "memory_context=7",
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
    expect(out).not.toMatch(/mode:\s+openai/);
    expect(out).toMatch(/model:\s+gpt-5-mini/);
    expect(out).toMatch(/provider:\s+openai/);
    expect(out).toContain("provider_ready:");
    expect(out).toMatch(/\n\s+status:\s+false/);
    expect(out).toMatch(/memory:\s+postgres/);
    expect(out).toMatch(/\n\s+entries:\s+7/);
    expect(out).toContain("om:");
    expect(out).toContain("enabled");
    expect(out).toMatch(/scope:\s+resource/);
    expect(out).toMatch(/model:\s+gpt-5-mini/);
    expect(out).toMatch(/\n\s+tokens:\s+obs=3000 ref=8000/);
    expect(out).toMatch(/\n\s+state:\s+exists=true gen=4/);
  });

  test("formatKeyValueLines aligns key/value rows", () => {
    const out = formatKeyValueLines([
      { session: "sess_123", active: "true" },
      { session: "sess_456", active: "false" },
    ]);
    expect(out).toEqual(["session: sess_123  active:  true", "session: sess_456  active:  false"]);
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

  test("formatPromptError maps actionable one-shot failures", () => {
    expect(formatPromptError(new Error("insufficient_quota: exceeded"))).toBe(
      "Provider quota exceeded. Add billing/credits or switch model/provider.",
    );
    expect(formatPromptError(new Error("Remote backend reply timed out after 120000ms"))).toBe(
      "Backend request timed out. Retry or reduce request scope.",
    );
    expect(formatPromptError(new Error("Shell command execution is disabled in read mode"))).toBe(
      "Write action blocked in read mode. Run /permissions write and retry.",
    );
    expect(formatPromptError(new Error("The socket connection was closed unexpectedly."))).toBe(
      "Backend unavailable. Start the backend and retry.",
    );
    expect(formatPromptError(new Error("Remote backend error (502): boom"))).toBe("Remote backend error (502): boom");
  });

  test("displayPromptForOutput hides dogfood preamble and keeps task line", () => {
    const prompt = ["Dogfood mode:", "- Keep response concise", "- Verify edits", "fix src/agent.ts output"].join("\n");
    expect(displayPromptForOutput(prompt)).toBe("fix src/agent.ts output");
    expect(displayPromptForOutput("plain prompt")).toBe("plain prompt");
  });

  test("oneShotResourceId derives stable isolated resource key", () => {
    expect(oneShotResourceId("sess_abcdef1234567890")).toBe("run-abcdef1234567890");
    expect(oneShotResourceId("sess_short")).toBe("run-short");
  });

  test("formatResumeCommand returns prod-friendly command", () => {
    expect(formatResumeCommand("sess_abcdef1234567890")).toBe("acolyte resume sess_abcdef1");
  });

  test("isTopLevelHelpCommand recognizes help variants", () => {
    expect(isTopLevelHelpCommand("help")).toBe(true);
    expect(isTopLevelHelpCommand("--help")).toBe(true);
    expect(isTopLevelHelpCommand("-h")).toBe(true);
    expect(isTopLevelHelpCommand("chat")).toBe(false);
    expect(isTopLevelHelpCommand(undefined)).toBe(false);
  });

  test("isTopLevelVersionCommand recognizes version variants", () => {
    expect(isTopLevelVersionCommand("version")).toBe(true);
    expect(isTopLevelVersionCommand("--version")).toBe(true);
    expect(isTopLevelVersionCommand("-V")).toBe(true);
    expect(isTopLevelVersionCommand("help")).toBe(false);
  });

  test("buildUsageCommandRows includes core commands", () => {
    const rows = buildUsageCommandRows();
    expect(rows.some((row) => row.command.startsWith("resume"))).toBe(true);
    expect(rows.some((row) => row.command.startsWith("run"))).toBe(true);
    expect(rows.some((row) => row.command.startsWith("chat"))).toBe(false);
    expect(rows.some((row) => row.command.startsWith("tool"))).toBe(false);
    expect(rows.some((row) => row.command.includes("help"))).toBe(false);
    expect(rows.some((row) => row.command.includes("version"))).toBe(false);
  });

  test("extractVersionFromPackageJsonText parses version safely", () => {
    expect(extractVersionFromPackageJsonText('{"name":"acolyte","version":"0.1.0"}')).toBe("0.1.0");
    expect(extractVersionFromPackageJsonText('{"name":"acolyte"}')).toBeNull();
    expect(extractVersionFromPackageJsonText("{bad json}")).toBeNull();
  });

  test("formatAssistantReplyOutput indents multiline assistant output", () => {
    const out = formatAssistantReplyOutput(["1. first", "2. second", "3. third"].join("\n"));
    expect(out).toBe(["• 1. first", "  2. second", "  3. third"].join("\n"));
  });

  test("formatAssistantReplyOutput preserves blank lines without trailing spaces", () => {
    const out = formatAssistantReplyOutput(["Summary", "", "Next step"].join("\n"));
    expect(out).toBe(["• Summary", "", "  Next step"].join("\n"));
  });

  test("formatAssistantReplyOutput wraps long lines with stable indentation", () => {
    const out = formatAssistantReplyOutput("1. first second third fourth fifth", 16);
    const lines = out.split("\n");
    expect(lines[0]).toBe("• 1. first second third");
    expect(lines[1]).toMatch(/^\s+fourth fifth$/);
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
