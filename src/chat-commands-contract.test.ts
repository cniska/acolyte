import { describe, expect, test } from "bun:test";
import { parseSlashCommand } from "./chat-commands-contract";

describe("parseSlashCommand", () => {
  test("parses root only", () => {
    expect(parseSlashCommand("/memory")).toEqual({
      root: "memory",
      sub: "",
      args: [],
      raw: "/memory",
    });
  });

  test("parses root + sub", () => {
    expect(parseSlashCommand("/memory rm")).toEqual({
      root: "memory",
      sub: "rm",
      args: [],
      raw: "/memory rm",
    });
  });

  test("parses root + sub + args", () => {
    expect(parseSlashCommand("/memory rm mem_abc")).toEqual({
      root: "memory",
      sub: "rm",
      args: ["mem_abc"],
      raw: "/memory rm mem_abc",
    });
  });

  test("trims whitespace", () => {
    expect(parseSlashCommand("  /workspaces  new  fix-auth  ")).toEqual({
      root: "workspaces",
      sub: "new",
      args: ["fix-auth"],
      raw: "  /workspaces  new  fix-auth  ",
    });
  });

  test("handles multiple args", () => {
    expect(parseSlashCommand("/workspaces new fix-auth -- do stuff")).toEqual({
      root: "workspaces",
      sub: "new",
      args: ["fix-auth", "--", "do", "stuff"],
      raw: "/workspaces new fix-auth -- do stuff",
    });
  });
});
