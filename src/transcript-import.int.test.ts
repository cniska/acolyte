import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyImportLedger, type ImportLedger, readImportLedger, writeImportLedger } from "./import-ledger";
import { createMemoryPolicy, type MemoryStore } from "./memory-contract";
import { createMemoryDistiller, type DistillObservation } from "./memory-distiller";
import { createSqliteMemoryStore } from "./memory-store";
import { gitEnv, pinEmbeddingProviders, tempDb, tempDir, writeGitOrigin } from "./test-utils";
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

function writeTranscript(dir: string, sessionId: string, cwd: string, prompts: string[], timestamp?: string): string {
  const at = timestamp ?? new Date().toISOString();
  const lines = prompts.flatMap((prompt, index) => [
    JSON.stringify({ type: "user", sessionId, cwd, timestamp: at, message: { role: "user", content: prompt } }),
    JSON.stringify({
      type: "assistant",
      sessionId,
      cwd,
      timestamp: at,
      message: { role: "assistant", content: [{ type: "text", text: `answered ${index}` }] },
    }),
  ]);
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

/** The gates a run applies before spending: this suite is about what distillation then does. */
function planFor(dir: string, workspace: string, ledger: ImportLedger, since = new Date(0)) {
  return planImport({
    dir,
    since,
    workspace,
    project: "acme/widgets",
    ledger,
    policy,
    countCommitsSince: async () => 0,
  });
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
      [{ kind: "finding", scope: "project", content: "widgets builds with Bun", topic: "tooling", supersedes: [] }],
      store,
    );

    const { sessions } = await planFor(transcripts, workspace, emptyImportLedger());
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
    const rerun = await planFor(transcripts, workspace, ledger);
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
        { kind: "finding", scope: "project", content: "widgets builds with Bun", topic: null, supersedes: [] },
        { kind: "preference", scope: "user", content: "prefers dashes in branch names", topic: null, supersedes: [] },
        { kind: "finding", scope: "session", content: "halfway through the refactor", topic: null, supersedes: [] },
      ],
    });

    const { sessions } = await planFor(transcripts, workspace, emptyImportLedger());
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
        return [
          {
            kind: "finding" as const,
            scope: "project" as const,
            content: `fact ${calls}`,
            topic: null,
            supersedes: [],
          },
        ];
      },
    });

    const first = await planFor(transcripts, workspace, emptyImportLedger());
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
    const second = await planFor(transcripts, workspace, ledger);
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
    writeGitOrigin(workspace, "git@github.com:acme/widgets.git");
    const older = writeTranscript(transcripts, "old", workspace, ["ancient"]);
    writeTranscript(transcripts, "new", workspace, ["recent"]);
    const longAgo = new Date(Date.now() - 72 * 3_600_000);
    utimesSync(older, longAgo, longAgo);

    const { sessions } = await planFor(
      transcripts,
      workspace,
      emptyImportLedger(),
      new Date(Date.now() - 24 * 3_600_000),
    );

    expect(sessions.map((session) => session.sourceSessionId)).toEqual(["new"]);
  });

  test("takes the sessions a real checkout has barely moved past and leaves the rest", async () => {
    const transcripts = createDir("acolyte-transcripts-");
    const workspace = createDir("acolyte-workspace-");
    const at = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();
    // Dated explicitly because `--since` resolves to the second: a commit sharing the session's
    // second would otherwise count as movement past it.
    const git = (date: string, ...args: string[]) =>
      Bun.spawnSync({
        cmd: ["git", ...args],
        cwd: workspace,
        env: gitEnv({ GIT_DIR: join(workspace, ".git"), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      });
    git(at(-60), "init", "-q", ".");
    git(at(-60), "remote", "add", "origin", "git@github.com:acme/widgets.git");
    git(at(-60), "commit", "-q", "--allow-empty", "-m", "before the session");

    writeTranscript(transcripts, "aaa", workspace, ["first"], at(-30));
    for (let i = 0; i < 3; i++) git(at(-10 + i), "commit", "-q", "--allow-empty", "-m", `after ${i}`);

    const measured = await planImport({
      dir: transcripts,
      since: new Date(0),
      workspace,
      project: "acme/widgets",
      ledger: emptyImportLedger(),
      policy,
    });
    const gated = await planImport({
      dir: transcripts,
      since: new Date(0),
      workspace,
      project: "acme/widgets",
      ledger: emptyImportLedger(),
      stalenessBudget: 2,
      policy,
    });

    expect(measured.sessions.map((session) => session.movement)).toEqual([3]);
    expect(gated.sessions).toEqual([]);
    expect(gated.stale.map((session) => session.movement)).toEqual([3]);
  });

  test("a transcript directory that does not exist plans nothing", async () => {
    const plan = await planFor(join(createDir("acolyte-empty-"), "missing"), createDir("acolyte-workspace-"), {
      ...emptyImportLedger(),
    });

    expect(plan).toEqual({ sessions: [], heldBack: 0, stale: [], unattributable: 0 });
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
