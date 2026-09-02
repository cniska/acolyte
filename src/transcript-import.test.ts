import { describe, expect, test } from "bun:test";
import { consumedExchanges, emptyImportLedger, type ImportLedger, markConsumed } from "./import-ledger";
import type { MemoryCommitContext, MemoryCommitMetrics, MemoryDistiller } from "./memory-contract";
import {
  CLAUDE_CODE_SOURCE,
  type ImportReader,
  type ImportSessionPlan,
  importedSessionId,
  importSession,
  planImport,
  runImport,
} from "./transcript-import";

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

const RECORDED_AT = "2026-08-20T09:00:00.000Z";

/** A session of `count` prompt/response pairs, all recorded in `cwd` at `timestamp`. */
function sessionFile(sessionId: string, cwd: string, count: number, timestamp: string | null = RECORDED_AT): string {
  const stamp = timestamp === null ? {} : { timestamp };
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(line({ type: "user", sessionId, cwd, ...stamp, message: { role: "user", content: `ask ${i}` } }));
    lines.push(
      line({
        type: "assistant",
        sessionId,
        cwd,
        ...stamp,
        message: { role: "assistant", content: [{ type: "text", text: `answer ${i}` }] },
      }),
    );
  }
  return lines.join("\n");
}

function readerFor(files: Record<string, string>, mtimes: Record<string, Date> = {}): ImportReader {
  return {
    listTranscripts: async () =>
      Object.keys(files).map((path, index) => ({ path, modifiedAt: mtimes[path] ?? new Date(1_000 + index) })),
    readTranscript: async (path) => files[path],
  };
}

function recordingDistiller(): { distiller: MemoryDistiller; calls: MemoryCommitContext[] } {
  const calls: MemoryCommitContext[] = [];
  const distiller: MemoryDistiller = {
    async commit(ctx): Promise<MemoryCommitMetrics | undefined> {
      calls.push(ctx);
      if (ctx.messages.length < 4) return undefined;
      return { projectPromotedFacts: 1, supersededFacts: 0, distillTokens: 10 };
    },
  };
  return { distiller, calls };
}

const PROJECT = "acme/widgets";

type PlanOverrides = {
  maxTurns?: number;
  includeStale?: boolean;
  mtimes?: Record<string, Date>;
  resolveProject?: (workspace: string) => string | null;
  countCommitsSince?: (sinceIso: string) => Promise<number>;
};

const fullPlan = (files: Record<string, string>, ledger: ImportLedger, overrides: PlanOverrides = {}) =>
  planImport({
    dir: "/transcripts",
    since: new Date(0),
    workspace: "/checkout",
    project: PROJECT,
    ledger,
    maxTurns: overrides.maxTurns,
    includeStale: overrides.includeStale,
    reader: readerFor(files, overrides.mtimes),
    resolveProject: overrides.resolveProject ?? (() => PROJECT),
    countCommitsSince: overrides.countCommitsSince ?? (async () => 0),
  });

async function plan(
  files: Record<string, string>,
  ledger: ImportLedger = emptyImportLedger(),
): Promise<ImportSessionPlan[]> {
  return [...(await fullPlan(files, ledger)).sessions];
}

describe("planImport", () => {
  test("reports each session's exchanges and the project its workspace names", async () => {
    const plans = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      sourceSessionId: "s1",
      project: "acme/widgets",
      workspace: "/repo",
      consumed: 0,
      pending: 3,
    });
    expect(plans[0].sessionId).toBe(importedSessionId(CLAUDE_CODE_SOURCE, "s1"));
    expect(plans[0].estimatedTokens).toBeGreaterThan(0);
  });

  test("counts only the exchanges the ledger has not consumed", async () => {
    const ledger = markConsumed(emptyImportLedger(), CLAUDE_CODE_SOURCE, "s1", 2);
    const plans = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 5) }, ledger);

    expect(plans[0]).toMatchObject({ consumed: 2, pending: 3 });
  });

  test("estimates nothing once a session is fully consumed", async () => {
    const ledger = markConsumed(emptyImportLedger(), CLAUDE_CODE_SOURCE, "s1", 5);
    const plans = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 5) }, ledger);

    expect(plans[0]).toMatchObject({ pending: 0, estimatedTokens: 0 });
  });

  test("skips a transcript that holds no exchange", async () => {
    expect(await plan({ "/transcripts/empty.jsonl": line({ type: "mode", mode: "normal" }) })).toEqual([]);
  });

  test("a turn budget cuts each session's tail and reports what it held back", async () => {
    const result = await fullPlan(
      {
        "/transcripts/a.jsonl": sessionFile("s1", "/repo", 5),
        "/transcripts/b.jsonl": sessionFile("s2", "/repo", 5),
      },
      emptyImportLedger(),
      { maxTurns: 7 },
    );

    expect(result.sessions.map((session) => session.pending)).toEqual([5, 2]);
    expect(result.sessions[1].exchanges.map((exchange) => exchange.prompt)).toEqual(["ask 0", "ask 1"]);
    expect(result.heldBack).toBe(3);
  });

  test("a budget already spent leaves the remaining sessions untouched", async () => {
    const result = await fullPlan(
      {
        "/transcripts/a.jsonl": sessionFile("s1", "/repo", 4),
        "/transcripts/b.jsonl": sessionFile("s2", "/repo", 4),
      },
      emptyImportLedger(),
      { maxTurns: 4 },
    );

    expect(result.sessions.map((session) => session.pending)).toEqual([4, 0]);
    expect(result.heldBack).toBe(4);
  });

  test("nothing is held back when the budget covers the window", async () => {
    const result = await fullPlan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, emptyImportLedger(), {
      maxTurns: 10,
    });

    expect(result).toMatchObject({ heldBack: 0 });
    expect(result.sessions[0].pending).toBe(3);
  });

  test("a budgeted run resumes from the ledger where it stopped", async () => {
    const files = { "/transcripts/a.jsonl": sessionFile("s1", "/repo", 5) };
    const first = await fullPlan(files, emptyImportLedger(), { maxTurns: 2 });
    const ledger = markConsumed(emptyImportLedger(), CLAUDE_CODE_SOURCE, "s1", first.sessions[0].exchanges.length);
    const second = await fullPlan(files, ledger, { maxTurns: 2 });

    expect(second.sessions[0]).toMatchObject({ consumed: 2, pending: 2 });
    expect(second.heldBack).toBe(1);
  });

  test("names a session by its file when the records carry no id", async () => {
    const orphan = line({
      type: "user",
      cwd: "/repo",
      timestamp: RECORDED_AT,
      message: { role: "user", content: "hi" },
    });
    const answer = line({
      type: "assistant",
      cwd: "/repo",
      timestamp: RECORDED_AT,
      message: { role: "assistant", content: [{ type: "text", text: "yo" }] },
    });
    const plans = await plan({ "/transcripts/abc.jsonl": `${orphan}\n${answer}` });

    expect(plans[0].sourceSessionId).toBe("abc");
  });

  test("counts the distill calls the pending turns will make, which is fewer than the turns", async () => {
    const plans = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 5) });

    expect(plans[0]).toMatchObject({ pending: 5, calls: 3 });
  });

  test("takes only the sessions whose recorded checkout belongs to this project", async () => {
    const result = await fullPlan(
      {
        "/transcripts/a.jsonl": sessionFile("mine", "/repo", 3),
        "/transcripts/b.jsonl": sessionFile("theirs", "/elsewhere", 3),
      },
      emptyImportLedger(),
      { resolveProject: (workspace) => (workspace === "/repo" ? PROJECT : "other/thing") },
    );

    expect(result.sessions.map((session) => session.sourceSessionId)).toEqual(["mine"]);
    expect(result.unattributable).toBe(0);
  });

  test("counts the sessions whose recorded directory identifies no project at all", async () => {
    const result = await fullPlan(
      {
        "/transcripts/a.jsonl": sessionFile("mine", "/repo", 3),
        "/transcripts/b.jsonl": sessionFile("lost", "/deleted", 3),
      },
      emptyImportLedger(),
      { resolveProject: (workspace) => (workspace === "/repo" ? PROJECT : null) },
    );

    expect(result.sessions.map((session) => session.sourceSessionId)).toEqual(["mine"]);
    expect(result.unattributable).toBe(1);
  });

  test("excludes a session the project has committed past, reporting what it measured", async () => {
    const result = await fullPlan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, emptyImportLedger(), {
      countCommitsSince: async () => 51,
    });

    expect(result.sessions).toEqual([]);
    expect(result.stale).toEqual([{ sourceSessionId: "s1", lastActivityAt: RECORDED_AT, movement: 51 }]);
  });

  test("keeps a session the project has barely moved past", async () => {
    const result = await fullPlan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, emptyImportLedger(), {
      countCommitsSince: async () => 50,
    });

    expect(result.sessions.map((session) => session.movement)).toEqual([50]);
    expect(result.stale).toEqual([]);
  });

  test("--include-stale takes the sessions the budget would have excluded, still marked stale", async () => {
    const result = await fullPlan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, emptyImportLedger(), {
      countCommitsSince: async () => 400,
      includeStale: true,
    });

    expect(result.sessions.map((session) => session.stale)).toEqual([true]);
    expect(result.sessions[0].pending).toBe(3);
    expect(result.stale).toEqual([]);
  });

  test("a session carrying no timestamp cannot be measured and fails the gate closed", async () => {
    const files = { "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3, null) };
    const excluded = await fullPlan(files, emptyImportLedger());
    const included = await fullPlan(files, emptyImportLedger(), { includeStale: true });

    expect(excluded.sessions).toEqual([]);
    expect(excluded.stale).toEqual([{ sourceSessionId: "s1", lastActivityAt: null, movement: null }]);
    expect(included.sessions.map((session) => session.sourceSessionId)).toEqual(["s1"]);
  });

  test("spends the budget oldest first by when the sessions happened, not when their files were touched", async () => {
    const result = await fullPlan(
      {
        "/transcripts/recent.jsonl": sessionFile("recent", "/repo", 3, "2026-08-22T09:00:00.000Z"),
        "/transcripts/older.jsonl": sessionFile("older", "/repo", 3, "2026-08-19T09:00:00.000Z"),
      },
      emptyImportLedger(),
      {
        maxTurns: 3,
        mtimes: {
          "/transcripts/recent.jsonl": new Date("2026-08-01T00:00:00.000Z"),
          "/transcripts/older.jsonl": new Date("2026-08-30T00:00:00.000Z"),
        },
      },
    );

    expect(result.sessions.map((session) => session.sourceSessionId)).toEqual(["older", "recent"]);
    expect(result.sessions.map((session) => session.pending)).toEqual([3, 0]);
  });

  test("orders an undated session by its file's mtime, the only time it has", async () => {
    const result = await fullPlan(
      {
        "/transcripts/dated.jsonl": sessionFile("dated", "/repo", 2, "2026-08-20T09:00:00.000Z"),
        "/transcripts/undated.jsonl": sessionFile("undated", "/repo", 2, null),
      },
      emptyImportLedger(),
      {
        includeStale: true,
        mtimes: {
          "/transcripts/dated.jsonl": new Date("2026-08-30T00:00:00.000Z"),
          "/transcripts/undated.jsonl": new Date("2026-08-01T00:00:00.000Z"),
        },
      },
    );

    expect(result.sessions.map((session) => session.sourceSessionId)).toEqual(["undated", "dated"]);
  });

  test("measures the repository once per session time rather than once per session", async () => {
    const measured: string[] = [];
    await fullPlan(
      {
        "/transcripts/a.jsonl": sessionFile("s1", "/repo", 2, RECORDED_AT),
        "/transcripts/b.jsonl": sessionFile("s2", "/repo", 2, RECORDED_AT),
        "/transcripts/c.jsonl": sessionFile("s3", "/repo", 2, "2026-08-21T09:00:00.000Z"),
      },
      emptyImportLedger(),
      {
        countCommitsSince: async (iso) => {
          measured.push(iso);
          return 0;
        },
      },
    );

    expect(measured).toEqual([RECORDED_AT, "2026-08-21T09:00:00.000Z"]);
  });
});

describe("importSession", () => {
  test("replays the session as a growing history, one commit per exchange", async () => {
    const [planned] = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) });
    const { distiller, calls } = recordingDistiller();

    const result = await importSession(planned, distiller, "openai/gpt-5-mini");

    expect(calls.map((c) => c.messages.length)).toEqual([1, 3, 5]);
    expect(calls.map((c) => c.output)).toEqual(["answer 0", "answer 1", "answer 2"]);
    expect(calls.every((c) => c.workspace === "/repo" && c.sessionId === planned.sessionId)).toBe(true);
    expect(result).toMatchObject({ distilled: 1, facts: 1, tokens: 10 });
  });

  test("skips the exchanges an earlier import already consumed but keeps them as history", async () => {
    const ledger = markConsumed(emptyImportLedger(), CLAUDE_CODE_SOURCE, "s1", 2);
    const [planned] = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, ledger);
    const { distiller, calls } = recordingDistiller();

    await importSession(planned, distiller, "openai/gpt-5-mini");

    expect(calls).toHaveLength(1);
    expect(calls[0].output).toBe("answer 2");
    expect(calls[0].messages).toHaveLength(5);
  });
});

describe("runImport", () => {
  test("records every turn it consumed, in order, across sessions", async () => {
    const plans = await plan({
      "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3),
      "/transcripts/b.jsonl": sessionFile("s2", "/repo", 3),
    });
    const { distiller } = recordingDistiller();
    const saved: ImportLedger[] = [];

    await runImport({
      plans,
      distiller,
      model: "openai/gpt-5-mini",
      ledger: emptyImportLedger(),
      saveLedger: async (next) => {
        saved.push(next);
      },
    });

    // One save per turn, and a session is fully recorded before the next one starts.
    expect(saved).toHaveLength(6);
    expect(saved.map((l) => consumedExchanges(l, CLAUDE_CODE_SOURCE, "s1"))).toEqual([1, 2, 3, 3, 3, 3]);
    expect(saved.map((l) => consumedExchanges(l, CLAUDE_CODE_SOURCE, "s2"))).toEqual([0, 0, 0, 1, 2, 3]);
  });

  test("an interrupted session keeps the turns it already paid for", async () => {
    const plans = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 6) });
    const saved: ImportLedger[] = [];
    let commits = 0;
    const distiller: MemoryDistiller = {
      async commit(): Promise<MemoryCommitMetrics | undefined> {
        commits++;
        if (commits === 4) throw new Error("interrupted");
        return { projectPromotedFacts: 1 };
      },
    };

    await expect(
      runImport({
        plans,
        distiller,
        model: "openai/gpt-5-mini",
        ledger: emptyImportLedger(),
        saveLedger: async (next) => {
          saved.push(next);
        },
      }),
    ).rejects.toThrow("interrupted");

    // Three turns were distilled before the failure, so a re-run must start at the fourth.
    expect(consumedExchanges(saved.at(-1) as ImportLedger, CLAUDE_CODE_SOURCE, "s1")).toBe(3);
  });

  test("a window with nothing pending distills nothing and writes no ledger", async () => {
    let ledger = emptyImportLedger();
    ledger = markConsumed(ledger, CLAUDE_CODE_SOURCE, "s1", 3);
    const plans = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, ledger);
    const { distiller, calls } = recordingDistiller();
    const saved: ImportLedger[] = [];

    const results = await runImport({
      plans,
      distiller,
      model: "openai/gpt-5-mini",
      ledger,
      saveLedger: async (next) => {
        saved.push(next);
      },
    });

    expect(results).toEqual([]);
    expect(calls).toEqual([]);
    expect(saved).toEqual([]);
  });
});
