import { describe, expect, test } from "bun:test";
import {
  buildUsageCommandRows,
  buildUsageOptionRows,
  commands,
  formatStatusOutput,
  hasHelpFlag,
  isServerConnectionFailure,
  isTopLevelHelpCommand,
  isTopLevelVersionCommand,
  parseDogfoodArgs,
  runResourceId,
} from "./cli-commands";

describe("cli-commands", () => {
  test("hasHelpFlag detects --help, -h, and help", () => {
    expect(hasHelpFlag(["--help"])).toBe(true);
    expect(hasHelpFlag(["-h"])).toBe(true);
    expect(hasHelpFlag(["help"])).toBe(true);
    expect(hasHelpFlag(["--file", "a.ts"])).toBe(false);
    expect(hasHelpFlag([])).toBe(false);
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

  test("buildUsageOptionRows lists help and version", () => {
    const rows = buildUsageOptionRows();
    expect(rows.some((row) => row.option.includes("--help"))).toBe(true);
    expect(rows.some((row) => row.option.includes("--version"))).toBe(true);
  });

  test("commands table covers all registered subcommands", () => {
    expect(commands.resume).toBeFunction();
    expect(commands.run).toBeFunction();
    expect(commands.history).toBeFunction();
    expect(commands.server).toBeFunction();
    expect(commands.status).toBeFunction();
    expect(commands.memory).toBeFunction();
    expect(commands.config).toBeFunction();
    expect(commands.tool).toBeFunction();
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

  test("runResourceId derives stable isolated resource key", () => {
    expect(runResourceId("sess_abcdef1234567890")).toBe("run-abcdef1234567890");
    expect(runResourceId("sess_short")).toBe("run-short");
  });

  test("formatStatusOutput aligns flat key-value fields", () => {
    const out = formatStatusOutput({
      provider: "openai",
      model: "gpt-5-mini",
      permissions: "write",
      service: "http://localhost:6767",
      memory: "postgres (7 entries)",
      observational_memory: "enabled (resource)",
    });
    expect(out).toMatch(/^provider:\s+openai$/m);
    expect(out).toMatch(/^model:\s+gpt-5-mini$/m);
    expect(out).toMatch(/^permissions:\s+write$/m);
    expect(out).toMatch(/^memory:\s+postgres \(7 entries\)$/m);
    expect(out).toMatch(/^observational_memory:\s+enabled \(resource\)$/m);
  });

  test("isServerConnectionFailure matches only reachability errors", () => {
    expect(isServerConnectionFailure(new Error("Cannot reach server at http://127.0.0.1:6767"))).toBe(true);
    expect(isServerConnectionFailure(new Error("Status check failed (401): unauthorized"))).toBe(false);
    expect(isServerConnectionFailure(new Error("boom"))).toBe(false);
    expect(isServerConnectionFailure("Cannot reach server")).toBe(false);
  });
});
