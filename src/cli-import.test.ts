import { describe, expect, test } from "bun:test";
import { type ImportModeDeps, importMode } from "./cli-import";
import { emptyImportLedger, type ImportLedger } from "./import-ledger";
import type { MemoryStore } from "./memory-contract";
import type { ImportSessionPlan, ImportSessionResult, RunImportOptions, StaleSessionRef } from "./transcript-import";

function samplePlan(overrides: Partial<ImportSessionPlan> = {}): ImportSessionPlan {
  return {
    sourceSessionId: "abcdef0123",
    path: "/transcripts/abcdef0123.jsonl",
    sessionId: "sess_abc123",
    workspace: "/repo",
    project: "acme/widgets",
    lastActivityAt: "2026-08-20T09:00:00.000Z",
    movement: 3,
    stale: false,
    exchanges: [],
    consumed: 0,
    pending: 4,
    calls: 2,
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
  asked: string[];
  closed: number;
  runs: RunImportOptions[];
};

type HarnessOptions = {
  ledger?: ImportLedger;
  distillAvailable?: boolean;
  interactive?: boolean;
  answer?: string | null;
  project?: string | null;
  stale?: StaleSessionRef[];
  unattributable?: number;
};

function harness(plans: ImportSessionPlan[], options: HarnessOptions = {}): Harness {
  const dim: string[] = [];
  const out: string[] = [];
  const errors: { name: string; message?: string }[] = [];
  const removed: string[] = [];
  const saved: ImportLedger[] = [];
  const asked: string[] = [];
  const runs: RunImportOptions[] = [];
  const state = { closed: 0 };
  const store = { close: () => state.closed++ } as unknown as MemoryStore;
  const ledger = options.ledger ?? emptyImportLedger();

  const deps: ImportModeDeps = {
    hasHelpFlag: () => false,
    interactive: options.interactive ?? true,
    prompt: (question) => {
      asked.push(question);
      return options.answer === undefined ? "y" : options.answer;
    },
    transcriptDir: "/transcripts",
    scratchDir: "/scratch",
    workspace: "/checkout",
    project: options.project === undefined ? "acme/widgets" : options.project,
    planImport: async ({ maxTurns }) => ({
      sessions: plans.map((plan) => ({ ...plan, pending: Math.min(plan.pending, maxTurns) })),
      heldBack: Math.max(plans.reduce((sum, plan) => sum + plan.pending, 0) - maxTurns, 0),
      stale: options.stale ?? [],
      unattributable: options.unattributable ?? 0,
    }),
    runImport: async (runOptions) => {
      runs.push(runOptions);
      const results: ImportSessionResult[] = runOptions.plans.map((plan) => ({
        plan,
        distilled: 2,
        facts: 3,
        superseded: 1,
        tokens: 500,
      }));
      for (const _ of results) saved.push(runOptions.ledger);
      return results;
    },
    createStore: () => store,
    createDistiller: () => ({ commit: async () => undefined }),
    resolveModel: () => ({ model: "openai/gpt-5-mini", available: options.distillAvailable ?? true }),
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
    asked,
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
    expect(h.dim.join("\n")).toContain("6 turns are left");
  });

  test("says nothing about held-back turns when the budget covered the window", async () => {
    const h = harness([samplePlan({ pending: 2 })]);
    await importMode(["--max-turns", "4"], h.deps);

    expect(h.dim.join("\n")).not.toContain("are left");
  });

  test("refuses to run without a usable model, naming what to connect", async () => {
    const h = harness([samplePlan()], { distillAvailable: false });
    await importMode([], h.deps);

    expect(h.errors[0].message).toContain("openai/gpt-5-mini");
    expect(h.errors[0].message).toContain("acolyte auth");
    expect(h.runs).toEqual([]);
    expect(h.removed).toEqual([]);
  });

  test("--dry-run still works with no usable model, since it makes no model call", async () => {
    const h = harness([samplePlan()], { distillAvailable: false });
    await importMode(["--dry-run"], h.deps);

    expect(h.errors).toEqual([]);
    expect(h.dim.join("\n")).toContain("abcdef01");
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
    expect(h.dim.join("\n")).toContain("1.2k");
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
    await importMode(["--json", "--yes"], h.deps);

    expect(h.dim).toEqual([]);
    expect(JSON.parse(h.out.join("\n"))).toMatchObject({
      session: "abcdef01",
      memories: "3",
      replaced: "1",
      tokens: "500",
    });
  });

  test("refuses where there is no project to import, naming what it needs", async () => {
    const h = harness([samplePlan()], { project: null });
    await importMode([], h.deps);

    expect(h.errors[0].message).toContain("owner/repo");
    expect(h.runs).toEqual([]);
    expect(h.removed).toEqual([]);
  });

  test("shows the plan and the cost band, then asks before the first model call", async () => {
    const h = harness([samplePlan()]);
    await importMode([], h.deps);

    expect(h.dim.join("\n")).toContain("4 turns to read");
    expect(h.dim.join("\n")).toContain("1.2k–41.2k");
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toContain("1.2k–41.2k");
    expect(h.runs).toHaveLength(1);
  });

  test("a refused question imports nothing", async () => {
    const h = harness([samplePlan()], { answer: "n" });
    await importMode([], h.deps);

    expect(h.runs).toEqual([]);
    expect(h.dim.join("\n")).toContain("Nothing imported");
  });

  test("--yes runs without asking", async () => {
    const h = harness([samplePlan()]);
    await importMode(["--yes"], h.deps);

    expect(h.asked).toEqual([]);
    expect(h.runs).toHaveLength(1);
  });

  test("refuses rather than assume consent when nobody can answer", async () => {
    const h = harness([samplePlan()], { interactive: false });
    await importMode([], h.deps);

    expect(h.errors[0].message).toContain("--yes");
    expect(h.asked).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  test("--json cannot show a plan to consent to, so it needs --yes", async () => {
    const h = harness([samplePlan()]);
    await importMode(["--json"], h.deps);

    expect(h.errors[0].message).toContain("--yes");
    expect(h.runs).toEqual([]);
  });

  test("--dry-run asks nothing, since it spends nothing", async () => {
    const h = harness([samplePlan()]);
    await importMode(["--dry-run"], h.deps);

    expect(h.asked).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  test("reports the sessions the staleness budget kept out and how to reach them", async () => {
    const h = harness([samplePlan()], {
      stale: [
        { sourceSessionId: "old1", lastActivityAt: "2026-01-01T00:00:00.000Z", movement: 88 },
        { sourceSessionId: "old2", lastActivityAt: "2026-02-01T00:00:00.000Z", movement: 240 },
      ],
    });
    await importMode(["--dry-run"], h.deps);

    expect(h.dim.join("\n")).toContain("Skipped 2 sessions: the project has up to 240 commits since they ended");
    expect(h.dim.join("\n")).toContain("--include-stale");
  });

  test("reports the sessions that carry no timestamp separately from the ones measured", async () => {
    const h = harness([samplePlan()], {
      stale: [
        { sourceSessionId: "old1", lastActivityAt: "2026-01-01T00:00:00.000Z", movement: 88 },
        { sourceSessionId: "undated", lastActivityAt: null, movement: null },
      ],
    });
    await importMode(["--dry-run"], h.deps);

    expect(h.dim.join("\n")).toContain("Skipped 1 session: the project has 88 commits since it ended");
    expect(h.dim.join("\n")).toContain("Skipped 1 session: it carries no time");
  });

  test("reports the in-window sessions no project can be resolved for", async () => {
    const h = harness([samplePlan()], { unattributable: 3 });
    await importMode(["--dry-run"], h.deps);

    expect(h.dim.join("\n")).toContain("3 sessions have no project");
  });

  test("says why a window that held only stale sessions imported nothing", async () => {
    const h = harness([samplePlan({ pending: 0 })], {
      stale: [{ sourceSessionId: "old1", lastActivityAt: "2026-01-01T00:00:00.000Z", movement: 88 }],
    });
    await importMode([], h.deps);

    expect(h.dim.join("\n")).toContain("acme/widgets");
    expect(h.dim.join("\n")).toContain("88 commits since it ended");
    expect(h.runs).toEqual([]);
  });
});
