import { describe, expect, test } from "bun:test";
import { dispatchSubcommandGroup, parseSlashCommand, type SubcommandGroup } from "./chat-commands-contract";

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

describe("dispatchSubcommandGroup", () => {
  test("dispatches to matching subcommand", async () => {
    const group: SubcommandGroup = {
      root: "test",
      subcommands: [
        {
          name: "rm",
          match: (sub) => sub === "rm",
          run: async (parsed) => ({ stop: true, userText: `removed:${parsed.args[0]}` }),
        },
      ],
      fallback: async () => ({ stop: true, userText: "fallback" }),
    };
    const result = await dispatchSubcommandGroup(group, "/test rm item");
    expect(result).toEqual({ stop: true, userText: "removed:item" });
  });

  test("uses first matching subcommand", async () => {
    const group: SubcommandGroup = {
      root: "test",
      subcommands: [
        { name: "first", match: () => true, run: async () => ({ stop: true, userText: "first" }) },
        { name: "second", match: () => true, run: async () => ({ stop: true, userText: "second" }) },
      ],
      fallback: async () => ({ stop: true, userText: "fallback" }),
    };
    const result = await dispatchSubcommandGroup(group, "/test anything");
    expect(result.userText).toBe("first");
  });

  test("falls back when no subcommand matches", async () => {
    const group: SubcommandGroup = {
      root: "test",
      subcommands: [{ name: "rm", match: (sub) => sub === "rm", run: async () => ({ stop: true, userText: "rm" }) }],
      fallback: async () => ({ stop: true, userText: "fallback" }),
    };
    const result = await dispatchSubcommandGroup(group, "/test unknown");
    expect(result.userText).toBe("fallback");
  });

  test("falls back for bare root command", async () => {
    const group: SubcommandGroup = {
      root: "test",
      subcommands: [{ name: "rm", match: (sub) => sub === "rm", run: async () => ({ stop: true, userText: "rm" }) }],
      fallback: async () => ({ stop: true, userText: "fallback" }),
    };
    const result = await dispatchSubcommandGroup(group, "/test");
    expect(result.userText).toBe("fallback");
  });

  test("passes args to subcommand match", async () => {
    let receivedArgs: string[] = [];
    const group: SubcommandGroup = {
      root: "test",
      subcommands: [
        {
          name: "check",
          match: (_sub, args) => {
            receivedArgs = args;
            return true;
          },
          run: async () => ({ stop: true, userText: "ok" }),
        },
      ],
      fallback: async () => ({ stop: true, userText: "fallback" }),
    };
    await dispatchSubcommandGroup(group, "/test check a b c");
    expect(receivedArgs).toEqual(["a", "b", "c"]);
  });

  test("falls back when subcommands array is empty", async () => {
    const group: SubcommandGroup = {
      root: "test",
      subcommands: [],
      fallback: async () => ({ stop: true, userText: "fallback" }),
    };
    const result = await dispatchSubcommandGroup(group, "/test anything");
    expect(result.userText).toBe("fallback");
  });
});
