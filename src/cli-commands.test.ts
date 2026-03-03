import { describe, expect, test } from "bun:test";
import { buildUsageCommandRows, buildUsageOptionRows, commands } from "./cli-commands";

describe("cli-commands", () => {
  test("buildUsageCommandRows includes core commands", () => {
    const rows = buildUsageCommandRows();
    expect(rows.some((row) => row.command.startsWith("init"))).toBe(true);
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
    expect(commands.init).toBeFunction();
    expect(commands.resume).toBeFunction();
    expect(commands.run).toBeFunction();
    expect(commands.history).toBeFunction();
    expect(commands.server).toBeFunction();
    expect(commands.status).toBeFunction();
    expect(commands.memory).toBeFunction();
    expect(commands.config).toBeFunction();
    expect(commands.tool).toBeFunction();
  });
});
