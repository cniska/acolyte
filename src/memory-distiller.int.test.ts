import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  createToolCallsPayload,
  type FakeProviderServer,
  startFakeProviderServer,
} from "../scripts/fake-provider-server";
import { appConfig } from "./app-config";
import { createMemoryPolicy } from "./memory-contract";
import { createMemoryDistiller } from "./memory-distiller";
import { createSqliteMemoryStore } from "./memory-store";
import { searchMemories } from "./memory-toolkit";
import { tempDb } from "./test-utils";

const testPolicy = createMemoryPolicy({ messageThreshold: 1 });

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-distiller-int-", createSqliteMemoryStore);

let fake: FakeProviderServer;
let savedBaseUrl: string;
let savedApiKey: string | undefined;
let savedDistillModel: string;

beforeAll(() => {
  savedBaseUrl = appConfig.openai.baseUrl;
  savedApiKey = appConfig.openai.apiKey;
  savedDistillModel = appConfig.distillModel;
  fake = startFakeProviderServer({
    handleRequest: (ctx) =>
      createToolCallsPayload(ctx.model, ctx.responseCounter, [
        {
          id: `fc_proj_${ctx.responseCounter}`,
          callId: `call_proj_${ctx.responseCounter}`,
          name: "memory_observe",
          args: JSON.stringify({ scope: "project", content: "project uses Bun as runtime", topic: "tooling" }),
        },
        {
          id: `fc_user_${ctx.responseCounter}`,
          callId: `call_user_${ctx.responseCounter}`,
          name: "memory_observe",
          args: JSON.stringify({ scope: "user", content: "prefers concise responses" }),
        },
        {
          id: `fc_sess_${ctx.responseCounter}`,
          callId: `call_sess_${ctx.responseCounter}`,
          name: "memory_observe",
          args: JSON.stringify({ scope: "session", content: "fixing memory search bug" }),
        },
      ]),
  });
  (appConfig.openai as { baseUrl: string }).baseUrl = fake.baseUrl;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = "fake-key";
  (appConfig as { distillModel: string }).distillModel = "gpt-4o-mini";
});

afterAll(() => {
  fake.stop();
  (appConfig.openai as { baseUrl: string }).baseUrl = savedBaseUrl;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
  (appConfig as { distillModel: string }).distillModel = savedDistillModel;
});

afterEach(cleanupStores);

describe("memoryDistiller integration", () => {
  test("defaultRunner emits memory_observe tool calls and stores all scopes", async () => {
    const store = createStore();
    const distiller = createMemoryDistiller({ store, policy: testPolicy });

    const metrics = await distiller.commit({
      sessionId: "sess_inttest001",
      resourceId: "proj_inttest001",
      messages: [
        { role: "user", content: "what runtime does this project use?" },
        { role: "assistant", content: "it uses Bun" },
      ],
      output: "it uses Bun",
    });

    expect(metrics).toBeDefined();
    expect(metrics?.projectPromotedFacts).toBe(1);
    expect(metrics?.userPromotedFacts).toBe(1);
    expect(metrics?.sessionScopedFacts).toBe(1);

    const all = await store.list();
    const projectEntry = all.find((r) => r.scopeKey === "proj_inttest001");
    expect(projectEntry?.content).toBe("project uses Bun as runtime");
    expect(projectEntry?.topic).toBe("tooling");

    const sessionEntry = all.find((r) => r.scopeKey === "sess_inttest001");
    expect(sessionEntry?.content).toBe("fixing memory search bug");

    const userEntry = all.find((r) => r.scopeKey.startsWith("user_"));
    expect(userEntry?.content).toBe("prefers concise responses");
  });

  test("project and user observations are returned by searchMemories", async () => {
    const store = createStore();
    const distiller = createMemoryDistiller({ store, policy: testPolicy });

    await distiller.commit({
      sessionId: "sess_inttest002",
      resourceId: "proj_inttest002",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
      output: "hi",
    });

    const results = await searchMemories("Bun runtime tooling", { store });
    const contents = results.map((r) => r.content);
    expect(contents).toContain("project uses Bun as runtime");
    expect(contents).toContain("prefers concise responses");
    expect(contents).not.toContain("fixing memory search bug");
  });
});
