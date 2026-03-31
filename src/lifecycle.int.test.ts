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

  test("@signal done completes after write tools", async () => {
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 2.\n\n@signal done");
    });

    const reply = await run("update x to 2");
    expect(turnCount).toBe(2);
    expect(reply.output).toContain("Updated x to 2.");
  });

  test("@signal no_op completes without write tools", async () => {
    setupFakeProvider((ctx) => {
      return createMessagePayload(ctx.model, ctx.responseCounter, "Nothing to do.\n\n@signal no_op");
    });

    const reply = await run("hello");
    expect(reply.output).toContain("Nothing to do.");
  });

  test("@signal blocked returns awaiting-input state", async () => {
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "Cannot proceed.\n\n@signal blocked");
    });

    const reply = await run("update x to 3");
    expect(reply.state).toBe("awaiting-input");
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 6.\n\n@signal done");
    });

    await runLifecycle({
      request: { model: "gpt-5-mini", message: "update x to 6", history: [], useMemory: false },
      soulPrompt: "",
      workspace,
      lifecyclePolicy: {
        formatCommand: { bin: "/bin/sh", args: [formatScript, "$FILES"] },
      },
    });

    expect(turnCount).toBe(2);
    expect(await readFile(formatLog, "utf8")).toContain(join(workspace, "a.ts"));
  });

  test("lint effect surfaces errors without regeneration", async () => {
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
      return createMessagePayload(ctx.model, ctx.responseCounter, "Updated x to 7.\n\n@signal done");
    });

    const reply = await runLifecycle({
      request: { model: "gpt-5-mini", message: "update x to 7", history: [], useMemory: false },
      soulPrompt: "",
      workspace,
      lifecyclePolicy: {
        lintCommand: { bin: "/bin/sh", args: [lintScript, "$FILES"] },
      },
    });

    expect(turnCount).toBe(2);
    expect(reply.output).toContain("Updated x to 7.");
  });
});
