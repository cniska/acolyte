import { describe, expect, test } from "bun:test";
import { type ImportModeDeps, importMode } from "./cli-import";
import { emptyImportLedger, type ImportLedger } from "./import-ledger";
import type { MemoryStore } from "./memory-contract";
import type { ImportSessionPlan, ImportSessionResult, RunImportOptions } from "./transcript-import";

function samplePlan(overrides: Partial<ImportSessionPlan> = {}): ImportSessionPlan {
  return {
    sourceSessionId: "abcdef0123",
    path: "/transcripts/abcdef0123.jsonl",
    sessionId: "sess_abc123",
    workspace: "/repo",
    project: "acme/widgets",
    exchanges: [],
    consumed: 0,
    pending: 4,
    estimatedTokens: 1_200,
    ...overrides,
  };
}

type Harness = {
  deps: ImportModeDeps;
  dim: string[];
  out: string[];
  errors: { name: string; message?: string }[];
  removed: string[];
  saved: ImportLedger[];
  closed: number;
  runs: RunImportOptions[];
};

function harness(plans: ImportSessionPlan[], ledger: ImportLedger = emptyImportLedger()): Harness {
  const dim: string[] = [];
  const out: string[] = [];
  const errors: { name: string; message?: string }[] = [];
  const removed: string[] = [];
  const saved: ImportLedger[] = [];
  const runs: RunImportOptions[] = [];
  const state = { closed: 0 };
  const store = { close: () => state.closed++ } as unknown as MemoryStore;

  const deps: ImportModeDeps = {
    hasHelpFlag: () => false,
    transcriptDir: "/transcripts",
    scratchDir: "/scratch",
    planImport: async ({ maxTurns }) => ({
      sessions: plans.map((plan) => ({ ...plan, pending: Math.min(plan.pending, maxTurns) })),
      heldBack: Math.max(plans.reduce((sum, plan) => sum + plan.pending, 0) - maxTurns, 0),
    }),
    runImport: async (options) => {
      runs.push(options);
      const results: ImportSessionResult[] = options.plans.map((plan) => ({
        plan,
        distilled: 2,
        facts: 3,
        superseded: 1,
        tokens: 500,
      }));
      for (const _ of results) saved.push(options.ledger);
      return results;
    },
    createStore: () => store,
    createDistiller: () => ({ commit: async () => undefined }),
    readLedger: async () => ledger,
    writeLedger: async (_path, next) => {
      saved.push(next);
    },
    removeDir: async (path) => {
      removed.push(path);
    },
    printDim: (message) => dim.push(message),
    printOutput: (message) => out.push(message),
    commandError: (name, message) => errors.push({ name, message }),
    commandHelp: () => {},
  };

  return {
    deps,
    dim,
    out,
    errors,
    removed,
    saved,
    runs,
    get closed() {
      return state.closed;
    },
  };
}

describe("importMode", () => {
  test("rejects an unparseable --since", async () => {
    const h = harness([samplePlan()]);
    await importMode(["--since", "yesterday"], h.deps);

    expect(h.errors[0].name).toBe("import");
    expect(h.errors[0].message).toContain("yesterday");
    expect(h.runs).toEqual([]);
  });

  test("rejects a stray positional argument", async () => {
    const h = harness([samplePlan()]);
    await importMode(["everything"], h.deps);

    expect(h.errors).toHaveLength(1);
    expect(h.runs).toEqual([]);
  });

  test("rejects a --max-turns that is not a positive whole number", async () => {
    for (const value of ["0", "-3", "lots", "2.5"]) {
      const h = harness([samplePlan()]);
      await importMode(["--max-turns", value], h.deps);

      expect(h.errors[0]?.message).toContain(value);
      expect(h.runs).toEqual([]);
    }
  });

  test("bounds the run to the turn budget and says what is left", async () => {
    const h = harness([samplePlan({ pending: 10 })]);
    await importMode(["--max-turns", "4"], h.deps);

    expect(h.runs[0].plans.map((plan) => plan.pending)).toEqual([4]);
    expect(h.dim.join("\n")).toContain("6 turns still waiting");
  });

  test("says nothing about held-back turns when the budget covered the window", async () => {
    const h = harness([samplePlan({ pending: 2 })]);
    await importMode(["--max-turns", "4"], h.deps);

    expect(h.dim.join("\n")).not.toContain("still waiting");
  });

  test("says so when the window holds nothing to import", async () => {
    const h = harness([samplePlan({ pending: 0 })]);
    await importMode([], h.deps);

    expect(h.dim.join("\n")).toContain("24h");
    expect(h.runs).toEqual([]);
  });

  test("--dry-run reports the plan without distilling", async () => {
    const h = harness([samplePlan()]);
    await importMode(["--dry-run"], h.deps);

    expect(h.runs).toEqual([]);
    expect(h.dim.join("\n")).toContain("abcdef01");
    expect(h.dim.join("\n")).toContain("acme/widgets");
    expect(h.dim.join("\n")).toContain("1200");
  });

  test("imports the pending sessions and names where they went", async () => {
    const h = harness([samplePlan(), samplePlan({ sourceSessionId: "second", pending: 0 })]);
    await importMode([], h.deps);

    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].plans.map((plan) => plan.sourceSessionId)).toEqual(["abcdef0123"]);
    expect(h.dim.join("\n")).toContain("/scratch");
    expect(h.closed).toBe(1);
  });

  test("--reset clears the throwaway corpus first", async () => {
    const h = harness([samplePlan({ pending: 0 })]);
    await importMode(["--reset"], h.deps);

    expect(h.removed).toEqual(["/scratch"]);
  });

  test("--json prints one record per session and no summary prose", async () => {
    const h = harness([samplePlan()]);
    await importMode(["--json"], h.deps);

    expect(h.dim).toEqual([]);
    expect(JSON.parse(h.out.join("\n"))).toMatchObject({
      session: "abcdef01",
      calls: "2",
      facts: "3",
      superseded: "1",
    });
  });
});
