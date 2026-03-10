import { describe, expect, test } from "bun:test";
import { memoryMode } from "./cli-memory";
import { dedent } from "./test-utils";

type MemoryDeps = Parameters<typeof memoryMode>[1];

function createDeps(overrides?: Partial<MemoryDeps>): { deps: MemoryDeps; output: () => string } {
  const lines: string[] = [];
  const deps: MemoryDeps = {
    addMemory: async (content, opts) => ({
      id: "mem_test123",
      content,
      scope: opts?.scope ?? "user",
      createdAt: "9999-01-01T00:00:00.000Z",
    }),
    hasHelpFlag: () => false,
    listMemories: async () => [
      {
        id: "mem_abc",
        content: "remember this",
        scope: "user" as const,
        createdAt: "9999-01-01T00:00:00.000Z",
      },
    ],
    printDim: (message) => lines.push(message),
    commandError: () => {},
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, output: () => lines.join("\n") };
}

describe("cli-memory", () => {
  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: (name) => {
        expect(name).toBe("memory");
        called = true;
      },
    });
    await memoryMode(["--help"], deps);
    expect(called).toBe(true);
  });

  test("list with no scope calls listMemories with scope all", async () => {
    let receivedScope: string | undefined;
    const { deps } = createDeps({
      listMemories: async (opts) => {
        receivedScope = opts?.scope;
        return [];
      },
    });
    await memoryMode(["list"], deps);
    expect(receivedScope).toBe("all");
  });

  test("list user calls listMemories with scope user", async () => {
    let receivedScope: string | undefined;
    const { deps } = createDeps({
      listMemories: async (opts) => {
        receivedScope = opts?.scope;
        return [];
      },
    });
    await memoryMode(["list", "user"], deps);
    expect(receivedScope).toBe("user");
  });

  test("list with invalid scope calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (name) => {
        expect(name).toBe("memory");
        called = true;
      },
    });
    await memoryMode(["list", "bogus"], deps);
    expect(called).toBe(true);
  });

  test("add --project saves memory with correct scope", async () => {
    let savedContent: string | undefined;
    let savedScope: string | undefined;
    const { deps, output } = createDeps({
      addMemory: async (content, opts) => {
        savedContent = content;
        savedScope = opts?.scope;
        return {
          id: "mem_test123",
          content,
          scope: opts?.scope ?? "user",
          createdAt: "9999-01-01T00:00:00.000Z",
        };
      },
    });
    await memoryMode(["add", "--project", "some", "text"], deps);
    expect(savedContent).toBe("some text");
    expect(savedScope).toBe("project");
    expect(output()).toBe(
      dedent(`
        Saved project memory mem_test123.
      `),
    );
  });

  test("add with no content calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (name) => {
        expect(name).toBe("memory");
        called = true;
      },
    });
    await memoryMode(["add"], deps);
    expect(called).toBe(true);
  });

  test("unknown subcommand calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (name) => {
        expect(name).toBe("memory");
        called = true;
      },
    });
    await memoryMode(["nope"], deps);
    expect(called).toBe(true);
  });
});
