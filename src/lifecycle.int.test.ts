import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

let fake: FakeProviderServer;
let workspace: string;
let savedBaseUrl: string;
let savedApiKey: string | undefined;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "acolyte-lifecycle-int-"));
  await writeFile(join(workspace, "a.ts"), "export const x = 1;\n", "utf8");

  savedBaseUrl = appConfig.openai.baseUrl;
  savedApiKey = appConfig.openai.apiKey;
});

afterAll(async () => {
  (appConfig.openai as { baseUrl: string }).baseUrl = savedBaseUrl;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
  await rm(workspace, { recursive: true, force: true });
});

function setupFakeProvider(handler: (ctx: FakeProviderRequestContext) => Record<string, unknown>): void {
  if (fake) fake.stop();
  fake = startFakeProviderServer({ handleRequest: handler });
  (appConfig.openai as { baseUrl: string }).baseUrl = fake.baseUrl;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = "fake-key";
}

function run(message: string) {
  return runLifecycle({
    request: { model: "gpt-5-mini", message, history: [], useMemory: false },
    soulPrompt: "",
    workspace,
  });
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

  test("@signal done with write tools skips verify without verify command", async () => {
    const phases: string[] = [];

    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;

      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        phases.push("work:tool-call");
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

      phases.push("work:done");
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 2.\n\n@signal done");
    });

    await run("update x to 2");

    expect(phases).toContain("work:tool-call");
    expect(phases).toContain("work:done");
    expect(phases).not.toContain("verify:done");
  });

  test("@signal no_op without write tools does not trigger verify", async () => {
    const phases: string[] = [];

    setupFakeProvider((ctx) => {
      phases.push("work:done");
      return createMessagePayload(ctx.model, ctx.responseCounter, "Nothing to do.\n\n@signal no_op");
    });

    const reply = await run("hello");

    expect(phases).toEqual(["work:done"]);
    expect(reply.output).toContain("Nothing to do.");
  });

  test("@signal blocked with write tools skips verify without verify command", async () => {
    let turnCount = 0;
    const phases: string[] = [];

    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        phases.push("work:tool-call");
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
      phases.push("work:blocked");
      return createMessagePayload(ctx.model, ctx.responseCounter, "Cannot proceed.\n\n@signal blocked");
    });

    await run("update x to 3");

    expect(phases).toContain("work:tool-call");
    expect(phases).toContain("work:blocked");
  });

  test("write tools remain single-pass without a verify stage", async () => {
    let turnCount = 0;
    const phases: string[] = [];

    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        phases.push("work:tool-call");
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 4;" }],
            }),
          },
        ]);
      }
      phases.push("work:done");
      return createMessagePayload(ctx.model, ctx.responseCounter, "Done.\n\n@signal done");
    });

    await runLifecycle({
      request: { model: "gpt-5-mini", message: "update x", history: [], useMemory: false },
      soulPrompt: "",
      workspace,
    });

    expect(phases).toContain("work:tool-call");
    expect(phases).toContain("work:done");
    expect(phases).not.toContain("verify:done");
  });

  test("no signal with write tools skips verify without verify command", async () => {
    let turnCount = 0;
    const phases: string[] = [];

    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-edit", ["edit"]);
        phases.push("work:tool-call");
        return createToolCallsPayload(ctx.model, ctx.responseCounter, [
          {
            id: `fc_${ctx.responseCounter}`,
            callId: `call_${ctx.responseCounter}`,
            name: toolName,
            args: JSON.stringify({
              path: join(workspace, "a.ts"),
              edits: [{ find: "export const x = 1;", replace: "export const x = 5;" }],
            }),
          },
        ]);
      }
      phases.push("work:text");
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated the file.");
    });

    await run("update x to 5");

    expect(phases).toContain("work:tool-call");
    expect(phases).not.toContain("verify:done");
  });

  test("format effect runs configured command for written files", async () => {
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 6.\n\n@signal done");
    });

    await runLifecycle({
      request: { model: "gpt-5-mini", message: "update x to 6", history: [], useMemory: false },
      soulPrompt: "",
      workspace,
      lifecyclePolicy: {
        formatCommand: { bin: "/bin/sh", args: [formatScript] },
      },
    });

    expect(turnCount).toBe(2);
    expect(await readFile(formatLog, "utf8")).toContain(join(workspace, "a.ts"));
  });

  test("separates iteration texts with newline in streamed output", async () => {
    await writeFile(join(workspace, "a.ts"), "export const x = 1;\n", "utf8");
    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "file-read", ["read"]);
        return createToolCallsPayload(
          ctx.model,
          ctx.responseCounter,
          [
            {
              id: `fc_${ctx.responseCounter}`,
              callId: `call_${ctx.responseCounter}`,
              name: toolName,
              args: JSON.stringify({ paths: [{ path: join(workspace, "a.ts") }] }),
            },
          ],
          "Reading the file.",
        );
      }
      return createMessagePayload(ctx.model, ctx.responseCounter, "Done reading.\n\n@signal done");
    });

    const textDeltas: string[] = [];
    const reply = await runLifecycle({
      request: { model: "gpt-5-mini", message: "read a.ts", history: [], useMemory: false },
      soulPrompt: "",
      workspace,
      onEvent: (event) => {
        if (event.type === "text-delta" && event.text) textDeltas.push(event.text);
      },
    });

    expect(turnCount).toBe(2);
    const streamedText = textDeltas.join("");
    expect(reply.output).toContain("Reading the file.");
    expect(reply.output).toContain("Done reading.");
    // The two iteration texts must be separated by a newline, not concatenated directly
    expect(streamedText).toContain("Reading the file.\nDone reading.");
  });

  test("lint effect regenerates with lifecycle feedback", async () => {
    await writeFile(join(workspace, "a.ts"), "export const x = 1;\n", "utf8");
    const lintState = join(workspace, ".lint-effect-state");
    const lintScript = await writeExecutableScript(
      "lint-effect.sh",
      `#!/bin/sh
if [ ! -f "${lintState}" ]; then
  touch "${lintState}"
  printf 'src/a.ts:1:1 lint error\n'
  exit 1
fi
exit 0
`,
    );

    const requests: string[] = [];
    let turnCount = 0;
    setupFakeProvider((ctx) => {
      turnCount += 1;
      requests.push(ctx.sourceText);
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
      if (turnCount === 2) {
        return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 7.\n\n@signal done");
      }
      return createMessagePayload(ctx.model, ctx.responseCounter, "Addressed lint feedback.\n\n@signal done");
    });

    const reply = await runLifecycle({
      request: { model: "gpt-5-mini", message: "update x to 7", history: [], useMemory: false },
      soulPrompt: "",
      workspace,
      lifecyclePolicy: {
        lintCommand: { bin: "/bin/sh", args: [lintScript] },
      },
    });

    expect(turnCount).toBe(3);
    expect(requests[2]).toContain("lifecycle feedback (lint)");
    expect(requests[2]).toContain("lint errors detected in files you edited");
    expect(reply.output).toContain("Addressed lint feedback.");
  });
});
