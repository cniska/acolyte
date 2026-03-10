import { describe, expect, test } from "bun:test";
import { suggestCommand, suggestCommands } from "./cli-command-suggest";

describe("cli-command-suggest", () => {
  test("suggestCommand resolves expected command from close typo", () => {
    expect(suggestCommand("/e")).toBe("/exit");
    expect(suggestCommand("/exi")).toBe("/exit");
    expect(suggestCommand("/ext")).toBe("/exit");
  });

  test("suggestCommands prefers prefix matches over edit-distance matches", () => {
    expect(suggestCommands("/ex", 3)).toEqual(["/exit"]);
    expect(suggestCommands("/", 3)).toEqual(["/exit"]);
  });

  test("suggestCommands enforces distance threshold for far-away input", () => {
    expect(suggestCommands("/totally-wrong-command", 3)).toEqual([]);
  });

  test("suggestCommands returns no suggestions for non-command input", () => {
    expect(suggestCommands("plain text", 3)).toEqual([]);
    expect(suggestCommands("", 3)).toEqual([]);
  });

  test("suggestCommands respects max suggestion count", () => {
    expect(suggestCommands("/ext", 1)).toEqual(["/exit"]);
  });
});
