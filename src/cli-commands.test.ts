import { describe, expect, test } from "bun:test";
import { commands } from "./cli-command-registry";

describe("cli-command-registry", () => {
  test("commands table covers all registered subcommands", () => {
    expect(commands.init).toBeFunction();
    expect(commands.resume).toBeFunction();
    expect(commands.run).toBeFunction();
    expect(commands.history).toBeFunction();
    expect(commands.start).toBeFunction();
    expect(commands.stop).toBeFunction();
    expect(commands.restart).toBeFunction();
    expect(commands.ps).toBeFunction();
    expect(commands.status).toBeFunction();
    expect(commands.memory).toBeFunction();
    expect(commands.config).toBeFunction();
    expect(commands.tool).toBeFunction();
  });
});
