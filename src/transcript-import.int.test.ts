import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyImportLedger, readImportLedger, writeImportLedger } from "./import-ledger";
import { createMemoryPolicy, type MemoryStore } from "./memory-contract";
import { createMemoryDistiller, type DistillObservation } from "./memory-distiller";
import { createSqliteMemoryStore } from "./memory-store";
import { pinEmbeddingProviders, tempDb, tempDir, writeGitOrigin } from "./test-utils";
import { CLAUDE_CODE_SOURCE, IMPORT_COMMIT_SCOPES, planImport, runImport } from "./transcript-import";

const { createDir, cleanupDirs } = tempDir();
const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-import-int-", createSqliteMemoryStore);
const policy = createMemoryPolicy({ messageThreshold: 1 });

let restoreEmbedding: () => void;

beforeAll(() => {
  restoreEmbedding = pinEmbeddingProviders({ embeddingApiKey: undefined });
});

afterAll(() => {
  restoreEmbedding();
});

afterEach(() => {
  cleanupDirs();
  cleanupStores();
});

function writeTranscript(dir: string, sessionId: string, cwd: string, prompts: string[]): string {
  const lines = prompts.flatMap((prompt, index) => [
    JSON.stringify({ type: "user", sessionId, cwd, message: { role: "user", content: prompt } }),
    JSON.stringify({
      type: "assistant",
      sessionId,
      cwd,
      message: { role: "assistant", content: [{ type: "text", text: `answered ${index}` }] },
    }),
  ]);
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

function distillerWriting(observations: DistillObservation[], store: MemoryStore) {
  return createMemoryDistiller({ store, policy, runner: async () => observations });
}

describe("transcript import", () => {
  test("distills a window into the throwaway store and leaves nothing to redo", async () => {
    const transcripts = createDir("acolyte-transcripts-");
    const workspace = createDir("acolyte-workspace-");
    writeGitOrigin(workspace, "git@github.com:acme/widgets.git");
    writeTranscript(transcripts, "aaa", workspace, ["first", "second"]);

    const scratch = createDir("acolyte-scratch-");
    const ledgerPath = join(scratch, "ledger.json");
    const store = createStore();
    const distiller = distillerWriting(
      [{ scope: "project", content: "widgets builds with Bun", topic: "tooling", supersedes: [] }],
      store,
    );

    const { sessions } = await planImport({
      dir: transcripts,
      since: new Date(0),
      ledger: emptyImportLedger(),
      policy,
    });
    expect(sessions.map((session) => session.project)).toEqual(["acme/widgets"]);

    const results = await runImport({
      plans: sessions,
      distiller,
      model: "openai/gpt-5-mini",
      ledger: emptyImportLedger(),
      saveLedger: (next) => writeImportLedger(ledgerPath, next),
    });

    expect(results[0].distilled).toBe(2);
    const stored = await store.list();
    expect(stored.map((record) => record.content)).toEqual(["widgets builds with Bun"]);
    expect(stored[0].scopeKey).toStartWith("proj_");

    const ledger = await readImportLedger(ledgerPath);
    const rerun = await planImport({ dir: transcripts, since: new Date(0), ledger, policy });
    expect(rerun.sessions.map((session) => session.pending)).toEqual([0]);
  });

  test("keeps the durable scopes and drops what dies with a session that is already over", async () => {
    const transcripts = createDir("acolyte-transcripts-");
    const workspace = createDir("acolyte-workspace-");
    writeGitOrigin(workspace, "git@github.com:acme/widgets.git");
    writeTranscript(transcripts, "aaa", workspace, ["first"]);

    const store = createStore();
    const distiller = createMemoryDistiller({
      store,
      policy,
      commitScopes: IMPORT_COMMIT_SCOPES,
      runner: async () => [
        { scope: "project", content: "widgets builds with Bun", topic: null, supersedes: [] },
        { scope: "user", content: "prefers dashes in branch names", topic: null, supersedes: [] },
        { scope: "session", content: "halfway through the refactor", topic: null, supersedes: [] },
      ],
    });

    const { sessions } = await planImport({
      dir: transcripts,
      since: new Date(0),
      ledger: emptyImportLedger(),
      policy,
    });
    await runImport({
      plans: sessions,
      distiller,
      model: "openai/gpt-5-mini",
      ledger: emptyImportLedger(),
      saveLedger: async () => {},
    });

    const stored = await store.list();
    expect(stored.map((record) => record.content).sort()).toEqual([
      "prefers dashes in branch names",
      "widgets builds with Bun",
    ]);
    expect(stored.some((record) => record.scopeKey.startsWith("sess_"))).toBe(false);
  });

  test("a second run over an unchanged window writes nothing and retires nothing", async () => {
    const transcripts = createDir("acolyte-transcripts-");
    const workspace = createDir("acolyte-workspace-");
    writeGitOrigin(workspace, "git@github.com:acme/widgets.git");
    writeTranscript(transcripts, "aaa", workspace, ["first", "second"]);

    const scratch = createDir("acolyte-scratch-");
    const ledgerPath = join(scratch, "ledger.json");
    const store = createStore();
    let calls = 0;
    const distiller = createMemoryDistiller({
      store,
      policy,
      runner: async () => {
        calls++;
        return [{ scope: "project" as const, content: `fact ${calls}`, topic: null, supersedes: [] }];
      },
    });

    const first = await planImport({ dir: transcripts, since: new Date(0), ledger: emptyImportLedger(), policy });
    await runImport({
      plans: first.sessions,
      distiller,
      model: "openai/gpt-5-mini",
      ledger: emptyImportLedger(),
      saveLedger: (next) => writeImportLedger(ledgerPath, next),
    });
    const afterFirst = await store.list();
    const callsAfterFirst = calls;

    const ledger = await readImportLedger(ledgerPath);
    const second = await planImport({ dir: transcripts, since: new Date(0), ledger, policy });
    await runImport({
      plans: second.sessions,
      distiller,
      model: "openai/gpt-5-mini",
      ledger,
      saveLedger: (next) => writeImportLedger(ledgerPath, next),
    });

    expect(calls).toBe(callsAfterFirst);
    expect(await store.list()).toEqual(afterFirst);
    expect(await store.listArchive()).toEqual([]);
  });

  test("the window selects sessions by last activity", async () => {
    const transcripts = createDir("acolyte-transcripts-");
    const workspace = createDir("acolyte-workspace-");
    const stale = writeTranscript(transcripts, "old", workspace, ["ancient"]);
    writeTranscript(transcripts, "new", workspace, ["recent"]);
    const longAgo = new Date(Date.now() - 72 * 3_600_000);
    utimesSync(stale, longAgo, longAgo);

    const { sessions } = await planImport({
      dir: transcripts,
      since: new Date(Date.now() - 24 * 3_600_000),
      ledger: emptyImportLedger(),
      policy,
    });

    expect(sessions.map((session) => session.sourceSessionId)).toEqual(["new"]);
  });

  test("a transcript directory that does not exist plans nothing", async () => {
    const plan = await planImport({
      dir: join(createDir("acolyte-empty-"), "missing"),
      since: new Date(0),
      ledger: emptyImportLedger(),
      policy,
    });

    expect(plan).toEqual({ sessions: [], heldBack: 0 });
  });
});

describe("import ledger", () => {
  test("round-trips through a file it creates", async () => {
    const dir = createDir("acolyte-ledger-");
    const path = join(dir, "nested", "ledger.json");
    const ledger = {
      version: 1 as const,
      sessions: { [`${CLAUDE_CODE_SOURCE}:aaa`]: { importedAt: new Date().toISOString(), exchanges: 7 } },
    };

    await writeImportLedger(path, ledger);

    expect(await readImportLedger(path)).toEqual(ledger);
  });

  test("a missing ledger reads as a first import", async () => {
    const dir = createDir("acolyte-ledger-");
    expect(await readImportLedger(join(dir, "ledger.json"))).toEqual(emptyImportLedger());
  });

  test("an unreadable ledger fails rather than re-importing everything it recorded", async () => {
    const dir = createDir("acolyte-ledger-");
    const path = join(dir, "ledger.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, '{"version":2,"sessions":{}}', "utf8");

    await expect(readImportLedger(path)).rejects.toThrow(/version/);
  });
});
