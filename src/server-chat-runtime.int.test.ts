import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMessagePayload, startFakeProviderServer } from "../scripts/fake-provider-server";
import { appConfig } from "./app-config";
import { setLocale } from "./i18n";
import { logLifecycleDebugEntry, runChatRequest } from "./server-chat-runtime";
import { tempDir } from "./test-utils";
import { createTraceStore } from "./trace-store";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("server chat runtime", () => {
  test("logLifecycleDebugEntry dual-writes to trace store", () => {
    const dir = createDir("acolyte-trace-srv-");
    const store = createTraceStore(join(dir, "trace.db"));
    logLifecycleDebugEntry({
      requestId: "err_xyz789",
      taskId: "task_dual",
      sessionId: "sess_dual",
      event: "lifecycle.start",
      sequence: 1,
      eventTs: "2026-03-20T12:00:00.000Z",
      fields: { model: "gpt-5", mode: "work" },
      logInfo: () => {},
      traceStore: store,
    });
    const lines = store.listByTaskId("task_dual");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.event).toBe("lifecycle.start");
    expect(lines[0]?.fields.model).toBe("gpt-5");
    store.close();
  });
});

describe("turn language", () => {
  test("a turn instructs the model in the workspace's configured language", async () => {
    const workspace = createDir("acolyte-locale-srv-");
    mkdirSync(join(workspace, ".acolyte"), { recursive: true });
    writeFileSync(join(workspace, ".acolyte", "config.json"), JSON.stringify({ locale: "sv" }), "utf8");

    const savedBaseUrl = appConfig.openai.baseUrl;
    const savedApiKey = appConfig.openai.apiKey;
    let systemPrompt = "";
    const fake = startFakeProviderServer({
      handleRequest: (ctx) => {
        systemPrompt = JSON.stringify(ctx.body.input);
        return createMessagePayload(ctx.model, ctx.responseCounter, "hej");
      },
    });
    (appConfig.openai as { baseUrl: string }).baseUrl = fake.baseUrl;
    (appConfig.openai as { apiKey: string | undefined }).apiKey = "fake-key";

    try {
      await runChatRequest(
        { model: "gpt-5-mini", message: "hej", history: [], workspace },
        { path: "/test", method: "POST", onEvent: () => {}, onDone: () => {}, onError: () => {} },
      );
      expect(systemPrompt).toContain("Reply in Swedish");
    } finally {
      fake.stop();
      (appConfig.openai as { baseUrl: string }).baseUrl = savedBaseUrl;
      (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
      setLocale("en");
    }
  });
});
