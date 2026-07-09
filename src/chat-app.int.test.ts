import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installClientLogSink, runChat } from "./chat-app";
import { getCachedRepoPathCandidates, invalidateRepoPathCandidates } from "./chat-file-ref";
import { log, setLogSink } from "./log";
import { stateDir } from "./paths";
import type { Session, SessionId, SessionState } from "./session-contract";
import { sessionIdSchema } from "./session-contract";
import { tempDir } from "./test-utils";

const dirs = tempDir();

afterEach(dirs.cleanupDirs);

describe("chat-ui integration helpers", () => {
  test("getCachedRepoPathCandidates refreshes after invalidation", async () => {
    const root = dirs.createDir("acolyte-at-cache-");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "a", "utf8");
    const first = await getCachedRepoPathCandidates(root);
    expect(first).toContain("src/a.ts");
    expect(first).not.toContain("sum.rs");
    await writeFile(join(root, "sum.rs"), "fn main() {}", "utf8");
    const stale = await getCachedRepoPathCandidates(root);
    expect(stale).not.toContain("sum.rs");
    invalidateRepoPathCandidates(root);
    const refreshed = await getCachedRepoPathCandidates(root);
    expect(refreshed).toContain("sum.rs");
  });
});

function withLogSinkEnv(
  fn: (ctx: { home: string; stdout: string[] }) => void,
  options: { debug?: boolean } = {},
): void {
  const home = dirs.createDir("acolyte-logsink-");
  const saved = {
    home: process.env.HOME,
    xdgState: process.env.XDG_STATE_HOME,
    debug: process.env.ACOLYTE_DEBUG,
    write: process.stdout.write,
  };
  const stdout: string[] = [];
  process.env.HOME = home;
  delete process.env.XDG_STATE_HOME;
  if (options.debug) process.env.ACOLYTE_DEBUG = "1";
  else delete process.env.ACOLYTE_DEBUG;
  mkdirSync(stateDir(), { recursive: true });
  process.stdout.write = ((data: string) => {
    stdout.push(data);
    return true;
  }) as typeof process.stdout.write;
  try {
    // Reset to the real startup state (the test preload installs a no-op sink;
    // production has none) so a missing sink would leak to stdout.
    setLogSink(null);
    fn({ home, stdout });
  } finally {
    setLogSink(() => {});
    process.stdout.write = saved.write;
    if (saved.home === undefined) delete process.env.HOME;
    else process.env.HOME = saved.home;
    if (saved.xdgState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved.xdgState;
    if (saved.debug === undefined) delete process.env.ACOLYTE_DEBUG;
    else process.env.ACOLYTE_DEBUG = saved.debug;
  }
}

describe("client log sink", () => {
  test("keeps logs off stdout when ACOLYTE_DEBUG is unset", () => {
    withLogSinkEnv(({ stdout }) => {
      installClientLogSink();
      log.debug("chat.submit", { value: "hello", resolved: "submit" });
      expect(stdout.join("")).not.toMatch(/level=debug/);
    });
  });

  test("diverts logs to client.log under ACOLYTE_DEBUG, never stdout", () => {
    withLogSinkEnv(
      ({ stdout }) => {
        installClientLogSink();
        log.debug("chat.submit", { value: "hello", resolved: "submit" });
        expect(stdout.join("")).not.toMatch(/level=debug/);
        const logged = readFileSync(join(stateDir(), "client.log"), "utf8");
        expect(logged).toMatch(/level=debug/);
        expect(logged).toContain("chat.submit");
      },
      { debug: true },
    );
  });
});

describe("runChat call-site", () => {
  test("installs log sink before first render — no logs leak to stdout", async () => {
    const home = dirs.createDir("acolyte-runchat-sink-");
    const saved = {
      home: process.env.HOME,
      xdgState: process.env.XDG_STATE_HOME,
      debug: process.env.ACOLYTE_DEBUG,
      isTTY: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
      write: process.stdout.write,
    };
    const stdout: string[] = [];
    process.env.HOME = home;
    delete process.env.XDG_STATE_HOME;
    delete process.env.ACOLYTE_DEBUG;
    mkdirSync(stateDir(), { recursive: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.stdout.write = ((data: string) => {
      stdout.push(data);
      return true;
    }) as typeof process.stdout.write;

    const sessionId = sessionIdSchema.parse("sess_runchattest") as SessionId;
    const now = new Date().toISOString();
    const session: Session = {
      id: sessionId,
      createdAt: now,
      updatedAt: now,
      model: "test-model",
      title: "Test",
      messages: [],
      tokenUsage: [],
    };
    const sessionState: SessionState = { sessions: [session], activeSessionId: sessionId };

    try {
      setLogSink(null);
      await runChat(
        {
          client: {
            replyStream: async () => {
              throw new Error("not called");
            },
            status: async () => ({}),
            taskStatus: async () => null,
          },
          session,
          sessionState,
          persist: async () => {},
          version: "0.0.0-test",
        },
        (app) => {
          // Sink is installed by the time onMount fires. Emit a log and unmount.
          log.debug("runChat.sink.check", { ok: true });
          app.unmount();
        },
      );
    } finally {
      process.stdout.write = saved.write;
      if (saved.isTTY) Object.defineProperty(process.stdout, "isTTY", saved.isTTY);
      if (saved.home === undefined) delete process.env.HOME;
      else process.env.HOME = saved.home;
      if (saved.xdgState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = saved.xdgState;
      if (saved.debug === undefined) delete process.env.ACOLYTE_DEBUG;
      else process.env.ACOLYTE_DEBUG = saved.debug;
      setLogSink(() => {});
    }

    expect(stdout.join("")).not.toMatch(/level=debug/);
    expect(stdout.join("")).not.toContain("runChat.sink.check");
  });
});
