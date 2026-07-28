import { describe, expect, test } from "bun:test";
import { memoryMode } from "./cli-memory";

import { dedent } from "./test-utils";

type MemoryDeps = Parameters<typeof memoryMode>[1];

type MemoryOps = MemoryDeps["ops"];

function createOps(overrides?: Partial<MemoryOps>): MemoryOps {
  return {
    list: async () => [
      {
        id: "mem_abc",
        kind: "stored" as const,
        content: "remember this",
        scope: "user" as const,
        createdAt: "9999-01-01T00:00:00.000Z",
        lastRecalledAt: null,
      },
    ],
    add: async (content, scope) => ({
      id: "mem_test123",
      kind: "stored" as const,
      content,
      scope: scope ?? "user",
      createdAt: "9999-01-01T00:00:00.000Z",
      lastRecalledAt: null,
    }),
    listArchived: async () => [
      {
        id: "mem_gone",
        kind: "observation" as const,
        content: "the src directory has 40 files",
        scope: "project" as const,
        createdAt: "9999-01-01T00:00:00.000Z",
        lastRecalledAt: null,
        retiredAt: "9999-01-02T00:00:00.000Z",
        disposition: { kind: "noise" as const },
      },
    ],
    restore: async (ids) =>
      ids.map((id) => ({
        id,
        kind: "observation" as const,
        content: "restored fact",
        scope: "project" as const,
        createdAt: "9999-01-01T00:00:00.000Z",
        lastRecalledAt: null,
      })),
    ...overrides,
  };
}

function createDeps(overrides?: Partial<MemoryDeps>): { deps: MemoryDeps; output: () => string } {
  const lines: string[] = [];
  const deps: MemoryDeps = {
    ops: createOps(),
    hasHelpFlag: () => false,
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

  test("list with no scope calls store.list with undefined scope", async () => {
    let receivedScope: string | undefined = "sentinel";
    const { deps } = createDeps({
      ops: createOps({
        list: async (scope) => {
          receivedScope = scope;
          return [];
        },
      }),
    });
    await memoryMode(["list"], deps);
    expect(receivedScope).toBeUndefined();
  });

  test("list user calls store.list with scope user", async () => {
    let receivedScope: string | undefined;
    const { deps } = createDeps({
      ops: createOps({
        list: async (scope) => {
          receivedScope = scope;
          return [];
        },
      }),
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
      ops: createOps({
        add: async (content, scope) => {
          savedContent = content;
          savedScope = scope;
          return {
            id: "mem_test123",
            kind: "stored" as const,
            content,
            scope: scope ?? "user",
            createdAt: "9999-01-01T00:00:00.000Z",
            lastRecalledAt: null,
          };
        },
      }),
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

  test("list --archived reads the archive instead of the active set", async () => {
    let listCalled = false;
    let archivedScope: string | undefined = "sentinel";
    const { deps, output } = createDeps({
      ops: createOps({
        list: async () => {
          listCalled = true;
          return [];
        },
        listArchived: async (scope) => {
          archivedScope = scope;
          return [
            {
              id: "mem_gone",
              kind: "observation",
              content: "the src directory has 40 files",
              scope: "project",
              createdAt: "9999-01-01T00:00:00.000Z",
              lastRecalledAt: null,
              retiredAt: "9999-01-02T00:00:00.000Z",
              disposition: { kind: "noise" },
            },
          ];
        },
      }),
    });
    await memoryMode(["list", "--archived"], deps);
    expect(listCalled).toBe(false);
    expect(archivedScope).toBeUndefined();
    expect(output()).toContain("mem_gone");
    expect(output()).toContain("noise");
  });

  test("list --archived honors a scope argument", async () => {
    let archivedScope: string | undefined;
    const { deps } = createDeps({
      ops: createOps({
        listArchived: async (scope) => {
          archivedScope = scope;
          return [];
        },
      }),
    });
    await memoryMode(["list", "project", "--archived"], deps);
    expect(archivedScope).toBe("project");
  });

  test("list --archived shows superseding lineage", async () => {
    const { deps, output } = createDeps({
      ops: createOps({
        listArchived: async () => [
          {
            id: "mem_old",
            kind: "observation",
            content: "half a fact",
            scope: "project",
            createdAt: "9999-01-01T00:00:00.000Z",
            lastRecalledAt: null,
            retiredAt: "9999-01-02T00:00:00.000Z",
            disposition: { kind: "superseded", by: ["mem_new"] },
          },
        ],
      }),
    });
    await memoryMode(["list", "--archived"], deps);
    expect(output()).toContain("superseded by mem_new");
  });

  test("empty archive reports the archive is empty", async () => {
    const { deps, output } = createDeps({
      ops: createOps({ listArchived: async () => [] }),
    });
    await memoryMode(["list", "--archived"], deps);
    expect(output()).toContain("No retired memories.");
  });

  test("restore passes ids through and reports what came back", async () => {
    let receivedIds: readonly string[] = [];
    const { deps, output } = createDeps({
      ops: createOps({
        restore: async (ids) => {
          receivedIds = ids;
          return ids.map((id) => ({
            id,
            kind: "observation" as const,
            content: "restored fact",
            scope: "project" as const,
            createdAt: "9999-01-01T00:00:00.000Z",
            lastRecalledAt: null,
          }));
        },
      }),
    });
    await memoryMode(["restore", "mem_abc", "mem_def"], deps);
    expect(receivedIds).toEqual(["mem_abc", "mem_def"]);
    expect(output()).toContain("mem_abc, mem_def");
  });

  test("restore with no ids calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (name) => {
        expect(name).toBe("memory");
        called = true;
      },
    });
    await memoryMode(["restore"], deps);
    expect(called).toBe(true);
  });

  test("restore rejects the archived flag", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: () => {
        called = true;
      },
    });

    await memoryMode(["restore", "--archived", "mem_abc"], deps);

    expect(called).toBe(true);
  });

  test("restore reports when nothing matched", async () => {
    const { deps, output } = createDeps({
      ops: createOps({ restore: async () => [] }),
    });
    await memoryMode(["restore", "mem_missing"], deps);
    expect(output()).toContain("mem_missing");
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
