import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMessagePayload,
  createToolCallsPayload,
  type FakeProviderRequestContext,
  type FakeProviderServer,
  pickFunctionToolName,
  startFakeProviderServer,
} from "../scripts/fake-provider-server";
import { appConfig } from "./app-config";
import { runLifecycle } from "./lifecycle";
import { createRunControl } from "./lifecycle-contract";
import { createLifecycleDeps, createLifecycleInput, tempDir } from "./test-utils";
import type { SessionContext } from "./tool-contract";
import { runTool } from "./tool-execution";
import { listUndoCheckpoints } from "./undo-checkpoints";

const dirs = tempDir();

let fake: FakeProviderServer;
let workspace: string;
let savedBaseUrl: string;
let savedApiKey: string | undefined;

beforeAll(() => {
  savedBaseUrl = appConfig.openai.baseUrl;
  savedApiKey = appConfig.openai.apiKey;
});

beforeEach(async () => {
  workspace = dirs.createDir("acolyte-lifecycle-int-");
  await writeFile(join(workspace, "a.ts"), "export const x = 1;\n", "utf8");
});

afterAll(() => {
  (appConfig.openai as { baseUrl: string }).baseUrl = savedBaseUrl;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
});

afterEach(dirs.cleanupDirs);

function setupFakeProvider(handler: (ctx: FakeProviderRequestContext) => Record<string, unknown>): void {
  if (fake) fake.stop();
  fake = startFakeProviderServer({ handleRequest: handler });
  (appConfig.openai as { baseUrl: string }).baseUrl = fake.baseUrl;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = "fake-key";
}

function run(message: string) {
  return runLifecycle(createLifecycleInput({ request: { model: "gpt-5-mini", message, history: [] }, workspace }));
}

function createSignalPayload(
  ctx: FakeProviderRequestContext,
  signal: "signal_done" | "signal_noop" | "signal_blocked",
  text: string,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  const toolName = pickFunctionToolName(ctx.body.tools, signal, [signal]);
  return createToolCallsPayload(
    ctx.model,
    ctx.responseCounter,
    [
      {
        id: `fc_${ctx.responseCounter}`,
        callId: `call_${ctx.responseCounter}`,
        name: toolName,
        args: JSON.stringify(args),
      },
    ],
    text,
  );
}

async function writeExecutableScript(name: string, body: string): Promise<string> {
  const path = join(workspace, name);
  await writeFile(path, body, "utf8");
  await chmod(path, 0o755);
  return path;
}

describe("lifecycle integration", () => {
  afterAll(() => {
    if (fake) fake.stop();
  });

  test("signal_done completion rejection continues to validation", async () => {
    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 2;" }],
            }),
          },
        ]);
      }
      if (turnCount === 2) {
        return createSignalPayload(ctx, "signal_done", "Updated x to 2.");
      }
      if (turnCount === 3) {
        const toolName = pickFunctionToolName(ctx.body.tools, "shell-run", ["shell"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({ cmd: "true" }),
          },
        ]);
      }
      return createSignalPayload(ctx, "signal_done", "Updated x to 2.");
    });

    const reply = await run("update x to 2");
    expect(turnCount).toBe(4);
    expect(reply.output).toContain("Updated x to 2.");
  });

  test("a prose reply after completion rejection re-opens the loop without blocking", async () => {
    // Regression (dogfood, residual): the missing-signal one-shot retry is spent, then
    // signal_done re-opens the loop via completion rejection. A prose reply to that
    // reminder must get a fresh retry — before the latch reset it hit missing-signal-block
    // and surfaced "Cannot finish yet" despite a valid signal.
    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 3;" }],
            }),
          },
        ]);
      }
      if (turnCount === 2) return createMessagePayload(ctx.model, ctx.responseCounter, "Edited the file.");
      if (turnCount === 3) return createSignalPayload(ctx, "signal_done", "Done.");
      // Prose reply to the reminder — must not block on the already-spent retry.
      if (turnCount === 4) return createMessagePayload(ctx.model, ctx.responseCounter, "Running validation next.");
      if (turnCount === 5) {
        const toolName = pickFunctionToolName(ctx.body.tools, "shell-run", ["shell"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({ cmd: "true" }),
          },
        ]);
      }
      return createSignalPayload(ctx, "signal_done", "Updated x to 3.");
    });

    const reply = await run("update x to 3");
    expect(reply.state).toBe("done");
    expect(reply.error).toBeUndefined();
    expect(reply.output).toContain("Updated x to 3.");
  });

  test("a tool error does not inject a recovery turn before finalization", async () => {
    let turnCount = 0;
    let secondTurnBody = "";
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-search", ["search"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({ pattern: "ZZZ_NO_SUCH_PATTERN_ZZZ", path: "." }),
          },
        ]);
      }
      secondTurnBody = JSON.stringify(ctx.body);
      return createSignalPayload(ctx, "signal_done", "No matches found; nothing to change.");
    });

    const reply = await run("find the missing pattern");
    // A no-match search is a normal outcome, not a broken run: the harness injects no
    // recovery turn, and the model's own next decision (here, a done) is accepted directly.
    expect(turnCount).toBe(2);
    expect(secondTurnBody).not.toContain("tool-error-recovery");
    expect(reply.state).toBe("done");
    expect(reply.output).toContain("No matches found");
  });

  test("signal_noop completes without write tools", async () => {
    setupFakeProvider((ctx) => {
      return createSignalPayload(ctx, "signal_noop", "Nothing to do.");
    });

    const reply = await run("hello");
    expect(reply.output).toContain("Nothing to do.");
  });

  test("signal_blocked returns awaiting-input state", async () => {
    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 3;" }],
            }),
          },
        ]);
      }
      return createSignalPayload(ctx, "signal_blocked", "Cannot proceed.", {
        reason: "Missing deployment environment. I will deploy once it is provided.",
      });
    });

    const reply = await run("update x to 3");
    expect(reply.state).toBe("awaiting-input");
  });

  test("signal_blocked uses tool reason when final text is empty", async () => {
    setupFakeProvider((ctx) => {
      return createSignalPayload(ctx, "signal_blocked", "", {
        reason: "Missing deployment environment. I will deploy once it is provided.",
      });
    });

    const reply = await run("deploy");
    expect(reply.state).toBe("awaiting-input");
    expect(reply.output).toBe("Missing deployment environment. I will deploy once it is provided.");
  });

  test("rejects duplicate lifecycle signal tools", async () => {
    setupFakeProvider((ctx) => {
      const doneName = pickFunctionToolName(ctx.body.tools, "signal_done", ["signal_done"]);
      const blockedName = pickFunctionToolName(ctx.body.tools, "signal_blocked", ["signal_blocked"]);
      return createToolCallsPayload(
        ctx.model,
        ctx.responseCounter,
        [
          {
            id: `fc_${ctx.responseCounter}_done`,
            callId: `call_${ctx.responseCounter}_done`,
            name: doneName,
            args: "{}",
          },
          {
            id: `fc_${ctx.responseCounter}_blocked`,
            callId: `call_${ctx.responseCounter}_blocked`,
            name: blockedName,
            args: JSON.stringify({ reason: "Missing input." }),
          },
        ],
        "Done.",
      );
    });

    const reply = await run("finish");
    expect(reply.state).toBe("done");
    expect(reply.error).toContain("more than one lifecycle signal tool");
  });

  test("rejects lifecycle signal tools mixed with ordinary tools", async () => {
    setupFakeProvider((ctx) => {
      const readName = pickFunctionToolName(ctx.body.tools, "file-read", ["read"]);
      const doneName = pickFunctionToolName(ctx.body.tools, "signal_done", ["signal_done"]);
      return createToolCallsPayload(
        ctx.model,
        ctx.responseCounter,
        [
          {
            id: `fc_${ctx.responseCounter}_read`,
            callId: `call_${ctx.responseCounter}_read`,
            name: readName,
            args: JSON.stringify({ path: join(workspace, "a.ts") }),
          },
          {
            id: `fc_${ctx.responseCounter}_done`,
            callId: `call_${ctx.responseCounter}_done`,
            name: doneName,
            args: "{}",
          },
        ],
        "Done.",
      );
    });

    const reply = await run("read and finish");
    expect(reply.state).toBe("done");
    expect(reply.error).toContain("must be the only tool call");
    expect(reply.toolCalls).toEqual([]);
  });

  test("format effect runs on written files", async () => {
    await writeFile(join(workspace, "a.ts"), "export const x = 1;\n", "utf8");
    const formatLog = join(workspace, "format.log");
    const formatScript = await writeExecutableScript(
      "format-effect.sh",
      `#!/bin/sh
printf '%s\n' "$@" > "${formatLog}"
`,
    );

    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 6;" }],
            }),
          },
        ]);
      }
      if (turnCount === 2) {
        const toolName = pickFunctionToolName(ctx.body.tools, "shell-run", ["shell"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({ cmd: "true" }),
          },
        ]);
      }
      return createSignalPayload(ctx, "signal_done", "Updated x to 6.");
    });

    await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "update x to 6", history: [] },
        workspace,
        lifecyclePolicy: { formatCommand: { bin: "/bin/sh", args: [formatScript, "$FILES"] } },
      }),
    );

    expect(turnCount).toBe(3);
    expect(await readFile(formatLog, "utf8")).toContain(join(workspace, "a.ts"));
  });

  test("lint effect output does not satisfy completion validation", async () => {
    await writeFile(join(workspace, "a.ts"), "export const x = 1;\n", "utf8");
    const lintScript = await writeExecutableScript(
      "lint-effect.sh",
      `#!/bin/sh
printf 'src/a.ts:1:1 lint error\n'
exit 1
`,
    );

    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 7;" }],
            }),
          },
        ]);
      }
      return createSignalPayload(ctx, "signal_done", "Updated x to 7.");
    });

    const reply = await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "update x to 7", history: [] },
        workspace,
        lifecyclePolicy: { lintCommand: { bin: "/bin/sh", args: [lintScript, "$FILES"] } },
      }),
    );

    expect(turnCount).toBe(3);
    expect(reply.state).toBe("awaiting-input");
    // User-audience terminal error — never the model-facing "Run a related test…" nudge.
    expect(reply.error).toContain("finished without validating its changes");
    expect(reply.error).not.toContain("Run a related test");
  });

  test("runControl yield skips result acceptance", async () => {
    setupFakeProvider((ctx) => {
      return createSignalPayload(ctx, "signal_done", "Hello there.");
    });

    const debugEvents: string[] = [];
    const reply = await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "hi", history: [] },
        workspace,
        runControl: createRunControl({ shouldYield: () => true }),
        onDebug: (entry) => debugEvents.push(entry.event),
      }),
    );

    expect(reply.output).toContain("Hello there.");
    expect(debugEvents).toContain("lifecycle.yield");
  });

  test("runControl yield replaces empty output", async () => {
    setupFakeProvider((ctx) => {
      return createSignalPayload(ctx, "signal_done", "  ");
    });

    const reply = await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "hi", history: [] },
        workspace,
        runControl: createRunControl({ shouldYield: () => true }),
      }),
    );

    expect(reply.output).toBe("Yielding to a newer pending message.");
  });

  test("captures undo checkpoint after write tool when enabled", async () => {
    const undoWorkspace = dirs.createDir("acolyte-lifecycle-undo-");
    await mkdir(join(undoWorkspace, ".acolyte"), { recursive: true });
    await writeFile(join(undoWorkspace, "a.txt"), "one\n", "utf8");

    const deps = createLifecycleDeps({
      phaseGenerate: mock(async (ctx: { session: SessionContext; result?: unknown }) => {
        await runTool(ctx.session, "file-edit", "call_1", { path: "a.txt" }, async () => {
          await writeFile(join(undoWorkspace, "a.txt"), "two\n", "utf8");
          return { ok: true };
        });

        (ctx as { result?: unknown }).result = { text: "done", toolCalls: [], signal: "done" };
      }),
    });

    await runLifecycle(
      createLifecycleInput({
        request: { model: "gpt-5-mini", message: "test", history: [], sessionId: "sess_undo" },
        soulPrompt: "SOUL",
        workspace: undoWorkspace,
        features: { syncAgents: false, undoCheckpoints: true, parallelWorkspaces: false, cloudSync: false, mcp: false },
      }),
      deps,
    );

    const checkpoints = await listUndoCheckpoints({ workspace: undoWorkspace, sessionId: "sess_undo", limit: 10 });
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0]?.toolId).toBe("file-edit");
    expect(checkpoints[0]?.paths).toEqual(["a.txt"]);
  });
});
