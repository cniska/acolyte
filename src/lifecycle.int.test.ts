import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
        const toolName = pickFunctionToolName(ctx.body.tools, "edit-file", ["edit"]);
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
        const toolName = pickFunctionToolName(ctx.body.tools, "edit-file", ["edit"]);
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

  test("verifyScope none skips verify even with write tools", async () => {
    let turnCount = 0;
    const phases: string[] = [];

    setupFakeProvider((ctx) => {
      turnCount += 1;
      if (turnCount === 1) {
        const toolName = pickFunctionToolName(ctx.body.tools, "edit-file", ["edit"]);
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
      request: { model: "gpt-5-mini", message: "update x", history: [], useMemory: false, verifyScope: "none" },
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
        const toolName = pickFunctionToolName(ctx.body.tools, "edit-file", ["edit"]);
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
});
