import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appConfig } from "./app-config";
import { currentLocale, setLocale } from "./i18n";
import * as lifecycleModule from "./lifecycle";
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
  test("a turn follows the workspace config locale, not the one the daemon booted with", async () => {
    const workspace = createDir("acolyte-locale-srv-");
    mkdirSync(join(workspace, ".acolyte"), { recursive: true });
    writeFileSync(join(workspace, ".acolyte", "config.json"), JSON.stringify({ locale: "sv" }), "utf8");

    const realLifecycle = { ...lifecycleModule };
    mock.module("./lifecycle", () => ({
      ...realLifecycle,
      runLifecycle: async () => ({ output: "hej", outputStreamed: false, model: "gpt-5-mini" }),
    }));

    const savedKey = appConfig.openai.apiKey;
    (appConfig.openai as { apiKey: string | undefined }).apiKey = "test-key";
    try {
      await runChatRequest(
        { model: "gpt-5-mini", message: "hej", history: [], workspace },
        { path: "/test", method: "POST", onEvent: () => {}, onDone: () => {}, onError: () => {} },
      );
      expect(currentLocale()).toBe("sv");
    } finally {
      (appConfig.openai as { apiKey: string | undefined }).apiKey = savedKey;
      setLocale("en");
      mock.module("./lifecycle", () => realLifecycle);
    }
  });
});
