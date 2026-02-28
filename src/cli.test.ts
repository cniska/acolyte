import { describe, expect, test } from "bun:test";
import {
  extractVersionFromPackageJsonText,
  formatResumeCommand,
  resolveChatApiUrl,
  resolveCommandAlias,
  suggestCommand,
  suggestCommands,
} from "./cli";

describe("cli", () => {
  test("extractVersionFromPackageJsonText parses version safely", () => {
    expect(extractVersionFromPackageJsonText('{"name":"acolyte","version":"0.1.0"}')).toBe("0.1.0");
    expect(extractVersionFromPackageJsonText('{"name":"acolyte"}')).toBeNull();
    expect(extractVersionFromPackageJsonText("{bad json}")).toBeNull();
  });

  test("formatResumeCommand returns prod-friendly command", () => {
    expect(formatResumeCommand("sess_abcdef1234567890")).toBe("acolyte resume sess_abcdef1234567890");
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

  test("resolveChatApiUrl defaults to localhost:6767 when apiUrl is missing", () => {
    expect(resolveChatApiUrl(undefined)).toBe("http://127.0.0.1:6767");
    expect(resolveChatApiUrl("")).toBe("http://127.0.0.1:6767");
  });
});
