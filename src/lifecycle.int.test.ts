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
      return createMessagePayload(ctx.model, ctx.responseCounter, "No matches found; nothing to change.");
    });

    const reply = await run("find the missing pattern");
    // A no-match search is a normal outcome, not a broken run: the harness injects no
    // recovery turn, and the model's own next final response is accepted directly.
    expect(turnCount).toBe(2);
    expect(secondTurnBody).not.toContain("tool-error-recovery");
    expect(reply.output).toContain("No matches found");
  });

  test("a text-only reply completes without write tools", async () => {
    setupFakeProvider((ctx) => {
      return createMessagePayload(ctx.model, ctx.responseCounter, "Nothing to do.");
    });

    const reply = await run("hello");
    expect(reply.output).toContain("Nothing to do.");
  });

  test("the model's final prose is the output with no error", async () => {
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
      return createMessagePayload(
        ctx.model,
        ctx.responseCounter,
        "Cannot proceed. Missing deployment environment; I will deploy once it is provided.",
      );
    });

    const reply = await run("update x to 3");
    expect(reply.output).toContain("Cannot proceed.");
    expect(reply.error).toBeUndefined();
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 6.");
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

  test("runControl yield skips result acceptance", async () => {
    setupFakeProvider((ctx) => {
      return createMessagePayload(ctx.model, ctx.responseCounter, "Hello there.");
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "  ");
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

        (ctx as { result?: unknown }).result = { text: "done", toolCalls: [] };
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

  test("mid-turn narration does not become the final response", async () => {
    // Regression: the narration cadence lets the model write short lines during tool work.
    // A narration line riding along a tool-calling step must not become the user's final
    // response — only the terminating no-tool-call step's text does.
    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      // A working step with a narration line riding along.
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "shell-run", ["shell"]);
        return createToolCallsPayload(
          ctx.model,
          ctx.responseCounter,
          [
            {
              id: `fc_${ctx.responseCounter}`,
              callId: `call_${ctx.responseCounter}`,
              name: toolName,
              args: JSON.stringify({ cmd: "true" }),
            },
          ],
          "Running the tests once more.",
        );
      }
      // The terminating step carries the real final response.
      return createMessagePayload(ctx.model, ctx.responseCounter, "Here is the summary of what changed.");
    });

    const reply = await run("update x to 4");
    expect(turnCount).toBe(2);
    expect(reply.error).toBeUndefined();
    expect(reply.output).toContain("Here is the summary of what changed.");
    expect(reply.output).not.toContain("Running the tests once more.");
  });
});
