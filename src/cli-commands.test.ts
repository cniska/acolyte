import { afterEach, describe, expect, test } from "bun:test";
import { commandHelpDoc, commands } from "./cli-command-registry";
import { setLocale } from "./i18n";

describe("cli-command-registry", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("help text follows the locale set after the registry loads", () => {
    setLocale("fi");
    expect(commandHelpDoc("run")?.description).toBe("suorita yksi kehote");
    setLocale("sv");
    expect(commandHelpDoc("run")?.description).toBe("kör en enskild prompt");
  });

  test("commands table covers all registered subcommands", () => {
    expect(commands.auth).toBeFunction();
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
