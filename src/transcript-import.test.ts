import { describe, expect, test } from "bun:test";
import { consumedExchanges, emptyImportLedger, type ImportLedger, markConsumed } from "./import-ledger";
import type { MemoryCommitContext, MemoryCommitMetrics, MemoryDistiller } from "./memory-contract";
import {
  CLAUDE_CODE_SOURCE,
  type ImportReader,
  importedSessionId,
  importSession,
  planImport,
  runImport,
} from "./transcript-import";

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

/** A session of `count` prompt/response pairs, all recorded in `cwd`. */
function sessionFile(sessionId: string, cwd: string, count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(line({ type: "user", sessionId, cwd, message: { role: "user", content: `ask ${i}` } }));
    lines.push(
      line({
        type: "assistant",
        sessionId,
        cwd,
        message: { role: "assistant", content: [{ type: "text", text: `answer ${i}` }] },
      }),
    );
  }
  return lines.join("\n");
}

function readerFor(files: Record<string, string>): ImportReader {
  return {
    listTranscripts: async () =>
      Object.keys(files).map((path, index) => ({ path, modifiedAt: new Date(1_000 + index) })),
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

const plan = (files: Record<string, string>, ledger: ImportLedger = emptyImportLedger()) =>
  planImport({
    dir: "/transcripts",
    since: new Date(0),
    ledger,
    reader: readerFor(files),
    resolveProject: () => "acme/widgets",
  });

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

  test("names a session by its file when the records carry no id", async () => {
    const orphan = line({ type: "user", cwd: "/repo", message: { role: "user", content: "hi" } });
    const answer = line({
      type: "assistant",
      cwd: "/repo",
      message: { role: "assistant", content: [{ type: "text", text: "yo" }] },
    });
    const plans = await plan({ "/transcripts/abc.jsonl": `${orphan}\n${answer}` });

    expect(plans[0].sourceSessionId).toBe("abc");
  });
});

describe("importSession", () => {
  test("replays the session as a growing history, one commit per exchange", async () => {
    const [planned] = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) });
    const { distiller, calls } = recordingDistiller();

    const result = await importSession(planned, distiller);

    expect(calls.map((c) => c.messages.length)).toEqual([1, 3, 5]);
    expect(calls.map((c) => c.output)).toEqual(["answer 0", "answer 1", "answer 2"]);
    expect(calls.every((c) => c.workspace === "/repo" && c.sessionId === planned.sessionId)).toBe(true);
    expect(result).toMatchObject({ distilled: 1, facts: 1, tokens: 10 });
  });

  test("skips the exchanges an earlier import already consumed but keeps them as history", async () => {
    const ledger = markConsumed(emptyImportLedger(), CLAUDE_CODE_SOURCE, "s1", 2);
    const [planned] = await plan({ "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3) }, ledger);
    const { distiller, calls } = recordingDistiller();

    await importSession(planned, distiller);

    expect(calls).toHaveLength(1);
    expect(calls[0].output).toBe("answer 2");
    expect(calls[0].messages).toHaveLength(5);
  });
});

describe("runImport", () => {
  test("records a session consumed before moving to the next", async () => {
    const plans = await plan({
      "/transcripts/a.jsonl": sessionFile("s1", "/repo", 3),
      "/transcripts/b.jsonl": sessionFile("s2", "/repo", 3),
    });
    const { distiller } = recordingDistiller();
    const saved: ImportLedger[] = [];

    await runImport({
      plans,
      distiller,
      ledger: emptyImportLedger(),
      saveLedger: async (next) => {
        saved.push(next);
      },
    });

    expect(saved).toHaveLength(2);
    expect(consumedExchanges(saved[0], CLAUDE_CODE_SOURCE, "s1")).toBe(3);
    expect(consumedExchanges(saved[0], CLAUDE_CODE_SOURCE, "s2")).toBe(0);
    expect(consumedExchanges(saved[1], CLAUDE_CODE_SOURCE, "s2")).toBe(3);
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
